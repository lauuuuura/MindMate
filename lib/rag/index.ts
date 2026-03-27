import fs from "node:fs";
import path from "node:path";
import { loadStageDocs } from "@/lib/agent/files";
import { Stage } from "@/lib/types";
import { ZhipuAI } from "zhipuai-sdk-nodejs-v4";

type Chunk = { stage: Stage; text: string };
type CacheItem = { text: string; embedding: number[] };
type CacheShape = Partial<Record<Stage, CacheItem[]>>;

function chunkText(text: string, stage: Stage): Chunk[] {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);
  return parts.map((textPart) => ({ stage, text: textPart.slice(0, 1000) }));
}

export async function retrieveStageContext(stage: Stage, query: string) {
  const docs = loadStageDocs();
  const allChunks = chunkText(docs[stage], stage);
  if (allChunks.length === 0) return "";

  const chunkTexts = allChunks.map((c) => c.text);
  // 默认 keyword：无额外网络调用；需要向量相似度时设 RAG_MODE=vector
  const mode = process.env.RAG_MODE || "keyword";
  if (mode === "keyword" || !process.env.ZHIPU_API_KEY) {
    return keywordRetrieve(chunkTexts, query, 4).join("\n\n");
  }

  try {
    const ai = new ZhipuAI({ apiKey: process.env.ZHIPU_API_KEY });
    const cache = readCache();
    const stageCache = cache[stage] ?? [];
    const cacheMap = new Map(stageCache.map((i) => [i.text, i.embedding]));
    const missing = allChunks.filter((c) => !cacheMap.has(c.text));

    if (missing.length > 0) {
      const embedModel = process.env.ZHIPU_EMBED_MODEL || "embedding-2";
      const newEmbeddings = await ai.embeddings.create({
        model: embedModel,
        input: missing.map((m) => m.text),
        encodingFormat: "float"
      });
      for (let i = 0; i < missing.length; i += 1) {
        cacheMap.set(missing[i].text, newEmbeddings.data[i]?.embedding ?? []);
      }
      cache[stage] = allChunks.map((c) => ({ text: c.text, embedding: cacheMap.get(c.text) ?? [] }));
      writeCache(cache);
    }

    const embedModel = process.env.ZHIPU_EMBED_MODEL || "embedding-2";
    const queryEmbedding = await ai.embeddings.create({
      model: embedModel,
      input: query,
      encodingFormat: "float"
    });

    const q = queryEmbedding.data[0]?.embedding ?? [];
    const scores = allChunks.map((chunk, idx) => ({
      idx,
      score: cosine(q, cacheMap.get(chunk.text) ?? [])
    }));
    scores.sort((a, b) => b.score - a.score);

    return scores
      .slice(0, 4)
      .map((s) => allChunks[s.idx]?.text ?? "")
      .filter(Boolean)
      .join("\n\n");
  } catch {
    // embedding 额度/模型不可用时，降级为本地关键词重排，避免整个对话失败
    return keywordRetrieve(allChunks.map((c) => c.text), query, 4).join("\n\n");
  }
}

const CACHE_PATH = path.join(process.cwd(), "data", "embeddings.json");

function readCache(): CacheShape {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as CacheShape;
  } catch {
    return {};
  }
}

function writeCache(data: CacheShape) {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

function keywordRetrieve(chunks: string[], query: string, topK: number) {
  const terms = query
    .toLowerCase()
    .split(/[\s,，。！？；:：、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const scored = chunks.map((text, idx) => {
    const lower = text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 1;
    }
    return { idx, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => chunks[s.idx]);
}
