/**
 * 结构化分析专用短提示（不嵌入完整 `角色.md`），显著降低首包延迟与费用。
 */
export const ANALYSIS_SYSTEM_PROMPT = `你是对话分析模块，只输出一个 JSON 对象，不要 markdown、不要解释。

字段要求（必须齐全）：
- topic: 关系冲突 | 重要决策 | 反复困扰 | 失落打击 | 自我认同波动 | 闲聊
- stage: 探索 | 领悟 | 行动
- five_state: 前沉思 | 沉思 | 准备 | 行动 | 维持
- should_update_label: true/false
- should_record_event: true/false（仅当 topic 为前五类且确有可记录事件时为 true）
- emotion: { "label": string, "intensity": 0-10 的数字, "evidence": string }
- technique: string（本回合拟用的沟通技术名，简短）
- event_overview: string（若 should_record_event 为 true 则写一句事件概述，否则可为空字符串）

只输出 JSON。`;
