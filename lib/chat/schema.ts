import { z } from "zod";

export const chatInputSchema = z.object({
  userId: z.string().min(3),
  /** 为 true 且服务端 SHOW_AGENT_REASONING=1 时，流式区分思维过程与最终回复 */
  showReasoning: z.boolean().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1)
    })
  )
});

export const analysisSchema = z.object({
  topic: z.enum(["关系冲突", "重要决策", "反复困扰", "失落打击", "自我认同波动", "闲聊"]),
  stage: z.enum(["探索", "领悟", "行动"]),
  five_state: z.enum(["前沉思", "沉思", "准备", "行动", "维持"]),
  should_update_label: z.boolean(),
  should_record_event: z.boolean(),
  emotion: z.object({
    label: z.string(),
    intensity: z.number().min(0).max(10),
    evidence: z.string()
  }),
  technique: z.string(),
  event_overview: z.string().default("")
});

export type AnalysisResult = z.infer<typeof analysisSchema>;
