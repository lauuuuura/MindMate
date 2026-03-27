import { NextResponse } from "next/server";
import { loadRolePrompt } from "@/lib/agent/files";
import { writeEventRecord } from "@/lib/archive/store";
import { ANALYSIS_SYSTEM_PROMPT } from "@/lib/chat/analysis-prompt";
import { analysisSchema, chatInputSchema, type AnalysisResult } from "@/lib/chat/schema";
import { initSchema } from "@/lib/db/schema";
import { readUserMemory, upsertUserMemory } from "@/lib/memory/store";
import { retrieveStageContext } from "@/lib/rag/index";
import { resolveUserId } from "@/lib/server/anon-user";
import { ZhipuAI } from "zhipuai-sdk-nodejs-v4";
import type { IncomingMessage } from "http";

type ZhipuCompletionsResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function isZhipuCompletionsResponse(v: unknown): v is ZhipuCompletionsResponse {
  return typeof v === "object" && v !== null && "choices" in v;
}

function isStreamLike(v: unknown): v is IncomingMessage & { on: (...args: unknown[]) => unknown } {
  return typeof v === "object" && v !== null && "on" in v && typeof (v as { on?: unknown }).on === "function";
}

function readIncomingMessageToString(msg: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = "";
    msg.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) acc += chunk.toString("utf-8");
      else acc += String(chunk);
    });
    msg.on("end", () => resolve(acc));
    msg.on("error", (err) => reject(err));
  });
}

const safetyKeywords = ["自杀", "自残", "不想活", "结束生命", "伤害自己"];

function hasSafetyRisk(text: string) {
  return safetyKeywords.some((k) => text.includes(k));
}

export async function POST(req: Request) {
  initSchema();
  let step = "requestValidation";
  try {
    if (!process.env.ZHIPU_API_KEY) {
      return NextResponse.json({ error: "Missing ZHIPU_API_KEY" }, { status: 500 });
    }

    step = "parseBody";
    const json = await req.json();
    const parsed = chatInputSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", detail: parsed.error.flatten() }, { status: 400 });
    }

    const { messages } = parsed.data;
    const userId = resolveUserId(req, parsed.data.userId);
    const latestUserText =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (hasSafetyRisk(latestUserText)) {
      return NextResponse.json({
        reply:
          "你现在的状态可能需要专业心理咨询师或医生的帮助，建议尽快联系线下心理机构或拨打心理援助热线（如400-652-5580）。",
        stage: "探索",
        should_record_event: true
      });
    }

    step = "loadRoleAndMemory";
    const rolePrompt = loadRolePrompt();
    const memory = readUserMemory(userId)
      .map((m) => `${m.category}: ${m.content}`)
      .slice(0, 12)
      .join("\n");

    const ai = new ZhipuAI({ apiKey: process.env.ZHIPU_API_KEY });
    const chatModel = process.env.ZHIPU_CHAT_MODEL || "glm-4-flash";
    // 分析阶段默认用轻量模型；与回复模型解耦，避免「分析也用大模型」拖慢首包
    const analysisModel = process.env.ZHIPU_ANALYSIS_MODEL || "glm-4-flash";
    const analysisMessages = messages.slice(-12);

    step = "zhipuAnalyze";
    const analysisCompletion = await ai.createCompletions({
      model: analysisModel,
      temperature: 0.1,
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content: ANALYSIS_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: `长期记忆:\n${memory || "无"}\n\n最近对话:\n${analysisMessages
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n")}`
        }
      ],
      stream: false
    });

    let analysisContent = "";
    if (isZhipuCompletionsResponse(analysisCompletion)) {
      analysisContent = analysisCompletion.choices?.[0]?.message?.content ?? "";
    } else if (isStreamLike(analysisCompletion)) {
      const raw = await readIncomingMessageToString(analysisCompletion);
      analysisContent = raw;
    }

    step = "parseAnalysisJson";
    const analysis = normalizeAnalysis(extractJson(analysisContent));
    step = "retrieveStageContext";
    const stageContext = await retrieveStageContext(analysis.stage, latestUserText);

    if (analysis.should_record_event) {
      step = "writeEventRecord";
      writeEventRecord({
        userId,
        topic: analysis.topic,
        eventOverview: analysis.event_overview || latestUserText.slice(0, 120),
        shouldRecord: analysis.should_record_event,
        intervention: {
          ts: new Date().toISOString(),
          userEmotion: `${analysis.emotion.label}(${analysis.emotion.intensity})`,
          fiveState: analysis.five_state,
          stage: analysis.stage,
          technique: analysis.technique,
          meta: {
            evidence: analysis.emotion.evidence,
            shouldUpdateLabel: analysis.should_update_label
          }
        }
      });
    }

    const memoryCandidate = latestUserText.match(/我(?:喜欢|讨厌|不想|希望).{0,30}/g) ?? [];
    if (memoryCandidate.length > 0) {
      upsertUserMemory(
        userId,
        memoryCandidate.map((content) => ({ category: "偏好与边界", content }))
      );
    }

    const envShowReasoning =
      process.env.SHOW_AGENT_REASONING === "1" || process.env.SHOW_AGENT_REASONING === "true";
    const showReasoningStream = envShowReasoning && parsed.data.showReasoning !== false;

    const meta = {
      stage: analysis.stage,
      five_state: analysis.five_state,
      emotion: analysis.emotion,
      should_record_event: analysis.should_record_event,
      streamMode: showReasoningStream ? ("split" as const) : ("plain" as const)
    };
    const metaForModel = {
      stage: meta.stage,
      five_state: meta.five_state,
      emotion: meta.emotion,
      should_record_event: meta.should_record_event
    };

    step = "zhipuReplyStream";
    const replySystem =
      `${rolePrompt}\n\n` +
      (showReasoningStream
        ? "若模型支持思考与回复分离：请把内部推理放在思考通道，面向用户的正文只写共情与回应，不要重复粘贴分析全文。"
        : "你必须只输出面向用户的自然对话正文。禁止输出任何内部策略、知识库引用、对用户状态的元分析（例如「用户现在」「根据阶段」「我的策略是」等）。不要暴露内部推理或规则。");
    const replyStream = await ai.createCompletions({
      model: chatModel,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: replySystem
        },
        {
          role: "user",
          content:
            `用户最新输入:\n${latestUserText}\n\n` +
            `结构化分析（供参考）：\n${JSON.stringify(metaForModel)}\n\n` +
            `阶段知识库检索结果(${analysis.stage}):\n${stageContext}`
        }
      ],
      stream: true
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        (async () => {
          controller.enqueue(encoder.encode(`${JSON.stringify(meta)}\n`));
          if (isStreamLike(replyStream)) {
            // 智谱流式为 SSE：多行 `data: {...}`，且 glm-4v 等可能只给 delta.reasoning_content
            let sseBuf = "";
            replyStream.on("data", (chunk: unknown) => {
              sseBuf += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
              const parts = sseBuf.split(/\r?\n/);
              sseBuf = parts.pop() ?? "";
              for (const line of parts) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":")) continue;
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                  const obj = JSON.parse(payload) as {
                    choices?: Array<{
                      delta?: { content?: string; reasoning_content?: string };
                    }>;
                  };
                  const delta = obj.choices?.[0]?.delta;
                  const reasoning =
                    typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
                  const content = typeof delta?.content === "string" ? delta.content : "";

                  if (showReasoningStream) {
                    if (reasoning.length > 0) {
                      controller.enqueue(
                        encoder.encode(`${JSON.stringify({ r: reasoning })}\n`)
                      );
                    }
                    if (content.length > 0) {
                      controller.enqueue(encoder.encode(`${JSON.stringify({ c: content })}\n`));
                    }
                  } else {
                    // 未开启思维分流时：只输出正文 delta，绝不把 reasoning_content 拼进同一段（否则勾选关闭仍会看到「思维」）
                    if (content.length > 0) controller.enqueue(encoder.encode(content));
                  }
                } catch {
                  // 忽略单行解析失败
                }
              }
            });
            replyStream.on("end", () => controller.close());
            replyStream.on("error", (e: unknown) => controller.error(e));
          } else {
            controller.close();
          }
        })();
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform"
      }
    });
  } catch (e) {
    let detail = "";
    if (e instanceof Error) detail = e.stack ?? e.message;
    else {
      try {
        detail = JSON.stringify(e);
      } catch {
        detail = String(e);
      }
    }
    return NextResponse.json({ error: "Server error", step, detail }, { status: 500 });
  }
}

function extractJson(text: string) {
  const trimmed = (text ?? "").trim();
  // 允许模型用代码块包装 JSON
  const withoutFences = trimmed.replace(/```(?:json)?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  const candidate = start !== -1 && end !== -1 ? withoutFences.slice(start, end + 1) : withoutFences;
  return JSON.parse(candidate);
}

function normalizeAnalysis(raw: unknown): AnalysisResult {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const emotionRaw =
    obj.emotion && typeof obj.emotion === "object" ? (obj.emotion as Record<string, unknown>) : {};

  const stage = normalizeStage(obj.stage);
  const fiveState = normalizeFiveState(obj.five_state);
  const topic = normalizeTopic(obj.topic);
  const intensityRaw =
    typeof emotionRaw.intensity === "number"
      ? emotionRaw.intensity
      : Number(String(emotionRaw.intensity ?? "").trim());
  const intensity = Number.isFinite(intensityRaw)
    ? Math.max(0, Math.min(10, intensityRaw))
    : 5;

  return analysisSchema.parse({
    topic,
    stage,
    five_state: fiveState,
    should_update_label: normalizeBoolean(obj.should_update_label),
    should_record_event: normalizeBoolean(obj.should_record_event),
    technique:
      typeof obj.technique === "string" && obj.technique.trim().length > 0
        ? obj.technique.trim()
        : "开放式提问",
    event_overview:
      typeof obj.event_overview === "string" ? obj.event_overview : "",
    emotion: {
      label:
        typeof emotionRaw.label === "string" && emotionRaw.label.trim().length > 0
          ? emotionRaw.label.trim()
          : "未识别",
      intensity,
      evidence:
        typeof emotionRaw.evidence === "string" && emotionRaw.evidence.trim().length > 0
          ? emotionRaw.evidence.trim()
          : "模型未给出明确依据"
    }
  });
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "yes", "y", "1", "是"].includes(text);
}

function normalizeStage(value: unknown): AnalysisResult["stage"] {
  const text = String(value ?? "").trim();
  if (text.includes("领悟")) return "领悟";
  if (text.includes("行动")) return "行动";
  // 初次交谈、轻微阶段、探索期等统一归探索
  return "探索";
}

function normalizeFiveState(value: unknown): AnalysisResult["five_state"] {
  const text = String(value ?? "").trim();
  if (text.includes("前沉思")) return "前沉思";
  if (text.includes("沉思")) return "沉思";
  if (text.includes("准备")) return "准备";
  if (text === "行动" || text.includes("行动状态")) return "行动";
  if (text.includes("维持")) return "维持";
  // 未知/未标注时默认沉思，避免直接报错中断
  return "沉思";
}

function normalizeTopic(value: unknown): AnalysisResult["topic"] {
  const text = String(value ?? "").trim();
  if (text.includes("关系")) return "关系冲突";
  if (text.includes("决策")) return "重要决策";
  if (text.includes("反复")) return "反复困扰";
  if (text.includes("失落") || text.includes("打击")) return "失落打击";
  if (text.includes("认同") || text.includes("价值")) return "自我认同波动";
  return "闲聊";
}
