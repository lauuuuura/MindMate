# MindMate

AI 倾听应用第一阶段实现（无登录匿名用户 + 动态阶段决策 + RAG + SQLite）。

## Quick Start

1. 安装 Node.js 20+。
2. 安装依赖：
   - `npm install`
3. 配置环境变量：
   - 复制 `.env.example` 为 `.env.local`
   - 填入 `OPENAI_API_KEY`
4. 启动：
   - `npm run dev`

## 已实现能力

- `角色.md` 软化为“每回合动态自检（原则约束）”。
- `/api/chat` 两段式调用：
  - 第一次结构化判定（stage/five_state/emotion/topic）。
  - 第二次结合阶段知识库生成回复。
- RAG：
  - 基于阶段文档分块检索。
  - Embedding 缓存到 `data/embeddings.json`。
- SQLite：
  - 事件档案、事件、干预历史、长期记忆。
- 档案写入兜底：
  - 仅主题阈值命中才写入。
  - 72 小时同主题归并。
- 匿名用户：
  - 浏览器 localStorage + 持久 cookie。

