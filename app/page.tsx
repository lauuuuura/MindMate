"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { getOrCreateAnonUserId } from "@/lib/anon-user";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** 仅 assistant，且服务端开启分流时 */
  reasoning?: string;
};

export default function HomePage() {
  const [userId, setUserId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "你好，我是梅梅。你可以慢慢说，我会认真听你。" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState("");
  const [showAnalyzingBanner, setShowAnalyzingBanner] = useState(false);
  const streamPendingRef = useRef({ content: "", reasoning: "" });
  const streamRafRef = useRef<number | null>(null);

  useEffect(() => {
    setUserId(getOrCreateAnonUserId());
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: input.trim() }
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setMeta("");
    setShowAnalyzingBanner(true);
    streamPendingRef.current = { content: "", reasoning: "" };

    try {
      const controller = new AbortController();
      const timeoutMs = 120_000;
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          messages: nextMessages
        }),
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "请求失败");
      }

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        setShowAnalyzingBanner(false);
        const data = (await res.json()) as {
          reply?: string;
          stage?: string;
          should_record_event?: boolean;
          error?: string;
        };
        const reply = data.reply;
        if (typeof reply === "string" && reply.length > 0) {
          setMeta(
            `阶段: ${data.stage ?? "探索"} | 危机响应 | 写档: ${data.should_record_event ? "是" : "否"}`
          );
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
          return;
        }
        throw new Error(data.error ? JSON.stringify(data) : "接口返回了无法解析的 JSON");
      }

      setMessages((prev) => [...prev, { role: "assistant", content: " ", reasoning: "" }]);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("浏览器不支持流式输出");

      const decoder = new TextDecoder("utf-8");
      let tail = "";
      let metaParsed = false;
      let streamMode: "plain" | "split" = "plain";

      const flushStreamPending = () => {
        streamRafRef.current = null;
        const p = streamPendingRef.current;
        if (!p.content && !p.reasoning) return;
        streamPendingRef.current = { content: "", reasoning: "" };
        setMessages((prev) => {
          const copy = [...prev];
          const curIndex = copy.length - 1;
          const cur = copy[curIndex];
          if (!cur || cur.role !== "assistant") return prev;
          copy[curIndex] = {
            ...cur,
            content: cur.content + p.content,
            reasoning: (cur.reasoning ?? "") + p.reasoning
          };
          return copy;
        });
      };

      const scheduleFlush = () => {
        if (streamRafRef.current != null) return;
        streamRafRef.current = requestAnimationFrame(flushStreamPending);
      };

      const appendPlain = (delta: string) => {
        streamPendingRef.current.content += delta;
        scheduleFlush();
      };

      const appendSplitLine = (line: string) => {
        try {
          const o = JSON.parse(line) as { r?: string; c?: string };
          if (typeof o.c === "string") streamPendingRef.current.content += o.c;
          if (typeof o.r === "string") streamPendingRef.current.reasoning += o.r;
          scheduleFlush();
        } catch {
          // 忽略单行解析失败
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (metaParsed && streamMode === "split" && tail.trim()) {
            appendSplitLine(tail.trim());
          }
          break;
        }
        tail += decoder.decode(value, { stream: true });

        if (!metaParsed) {
          const nl = tail.indexOf("\n");
          if (nl === -1) continue;
          const metaLine = tail.slice(0, nl).trim();
          tail = tail.slice(nl + 1);
          metaParsed = true;
          setShowAnalyzingBanner(false);
          try {
            const m = JSON.parse(metaLine) as {
              stage?: string;
              five_state?: string;
              emotion?: { label?: string };
              streamMode?: "plain" | "split";
            };
            streamMode = m.streamMode === "split" ? "split" : "plain";
            setMeta(
              `阶段: ${m.stage ?? "-"} | 五状态: ${m.five_state ?? "-"} | 情绪: ${m.emotion?.label ?? "-"}`
            );
          } catch {
            setMeta("阶段/情绪解析失败");
          }
          continue;
        }

        if (streamMode === "plain") {
          if (tail.length > 0) {
            const delta = tail;
            tail = "";
            appendPlain(delta);
          }
        } else {
          while (true) {
            const nl = tail.indexOf("\n");
            if (nl === -1) break;
            const line = tail.slice(0, nl).trim();
            tail = tail.slice(nl + 1);
            if (line.length > 0) appendSplitLine(line);
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? `请求超时（${Math.round(120_000 / 1000)} 秒），请检查网络或稍后重试`
          : err instanceof Error
            ? err.message
            : "未知错误";
      setMessages((prev) => [...prev, { role: "assistant", content: `出现错误：${msg}` }]);
    } finally {
      if (streamRafRef.current != null) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
      const pend = streamPendingRef.current;
      if (pend.content || pend.reasoning) {
        streamPendingRef.current = { content: "", reasoning: "" };
        setMessages((prev) => {
          const copy = [...prev];
          const curIndex = copy.length - 1;
          const cur = copy[curIndex];
          if (!cur || cur.role !== "assistant") return prev;
          copy[curIndex] = {
            ...cur,
            content: cur.content + pend.content,
            reasoning: (cur.reasoning ?? "") + pend.reasoning
          };
          return copy;
        });
      }
      setShowAnalyzingBanner(false);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-4">
      <h1 className="mb-2 text-2xl font-semibold">MindMate AI 倾听</h1>
      <p className="mb-4 text-sm text-gray-600">匿名用户ID已建立（同浏览器可持久）：{userId || "加载中..."}</p>

      {showAnalyzingBanner && (
        <p className="mb-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          分析中：正在做结构化判定与知识检索；完成后会流式输出回复，请稍候。
        </p>
      )}

      <section className="flex-1 space-y-3 overflow-y-auto rounded-lg bg-white p-4 shadow">
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === "user" ? "text-right" : "text-left"}>
            {msg.role === "assistant" && (msg.reasoning?.trim() ?? "").length > 0 ? (
              <div className="inline-block max-w-[85%] space-y-2 text-left">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
                  <div className="mb-1 font-medium text-amber-900">思维过程</div>
                  <div className="whitespace-pre-wrap font-mono leading-relaxed">{msg.reasoning}</div>
                </div>
                <div className="rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-800">
                  <div className="mb-1 text-xs font-medium text-gray-500">回复</div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ) : (
              <div
                className={`inline-block max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                  msg.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-800"
                }`}
              >
                {msg.content}
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="mt-2 min-h-5 text-xs text-gray-500">{meta}</div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
          placeholder="输入你想说的话..."
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "发送中..." : "发送"}
        </button>
      </form>
    </main>
  );
}
