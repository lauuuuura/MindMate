export type Stage = "探索" | "领悟" | "行动";

export type FiveState = "前沉思" | "沉思" | "准备" | "行动" | "维持";

export type TopicType =
  | "关系冲突"
  | "重要决策"
  | "反复困扰"
  | "失落打击"
  | "自我认同波动"
  | "闲聊";

export type Intervention = {
  ts: string;
  userEmotion: string;
  fiveState: FiveState;
  stage: Stage;
  technique: string;
  meta?: Record<string, unknown>;
};
