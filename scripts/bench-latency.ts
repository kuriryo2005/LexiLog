/**
 * レイテンシの実測。TTFT（最初のトークンまで）が支配的なので、
 * thinking 設定とスキーマの大きさがそこにどう効くかを測る。
 *
 *   npx tsx scripts/bench-latency.ts
 */
import { readFileSync } from "node:fs";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { WORD_SCHEMA, MODEL, buildLookupPrompt } from "../api/_lib/gemini.js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** 最初に表示したい項目だけの軽いスキーマ */
const CORE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    word: { type: Type.STRING },
    meaning: { type: Type.STRING },
    grammar: { type: Type.STRING },
    phonetic: { type: Type.STRING },
    nuance: { type: Type.STRING },
  },
  required: ["word", "meaning", "grammar", "phonetic", "nuance"],
};

interface Case {
  label: string;
  schema: unknown;
  thinking?: { thinkingLevel: ThinkingLevel };
  word: string;
}

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : [MODEL];

const cases: Case[] = [
  { label: "full schema / MINIMAL", schema: WORD_SCHEMA, thinking: { thinkingLevel: ThinkingLevel.MINIMAL }, word: "ubiquitous" },
  { label: "core schema / MINIMAL", schema: CORE_SCHEMA, thinking: { thinkingLevel: ThinkingLevel.MINIMAL }, word: "pragmatic" },
];
console.log("モデル / 条件".padEnd(46) + "TTFT".padStart(8) + "合計".padStart(9) + "  文字数");
console.log("-".repeat(76));

for (const model of MODELS) {
for (const c of cases) {
  const t0 = Date.now();
  let ttft = 0;
  let buffer = "";
  try {
    const stream = await ai.models.generateContentStream({
      model,
      contents: buildLookupPrompt(c.word, "gen"),
      config: {
        responseMimeType: "application/json",
        responseSchema: c.schema as never,
        // Gemini 3 系は thinkingLevel、2.5 系は thinkingBudget を使う
        thinkingConfig: model.startsWith("gemini-3")
          ? c.thinking
          : { thinkingBudget: 0 },
      },
    });
    for await (const chunk of stream) {
      if (!chunk.text) continue;
      if (!ttft) ttft = Date.now() - t0;
      buffer += chunk.text;
    }
    const total = Date.now() - t0;
    console.log(
      `${model} / ${c.label}`.padEnd(46) +
        `${(ttft / 1000).toFixed(1)}s`.padStart(8) +
        `${(total / 1000).toFixed(1)}s`.padStart(9) +
        `  ${buffer.length}`
    );
  } catch (e) {
    console.log(`${model} / ${c.label}`.padEnd(46) + "  ERROR " + (e instanceof Error ? e.message.slice(0, 50) : ""));
  }
}
}
