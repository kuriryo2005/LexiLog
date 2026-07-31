/**
 * サーバー側の Gemini クライアントとプロンプト定義（実装仕様書 F1）。
 *
 * GEMINI_API_KEY はサーバーの環境変数からのみ読む。
 * このファイルはブラウザに配信されないため、キーがクライアントへ漏れない。
 */

import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

/**
 * 使用モデル。
 *
 * 旧: gemini-3-flash-preview
 * 実測で最初のトークンまで 15〜20 秒かかり、合計 17〜23 秒。thinkingLevel を
 * MINIMAL にしてもスキーマを小さくしても改善しなかった（scripts/bench-latency.ts）。
 * gemini-2.5-flash は同じ内容を TTFT 1.0 秒 / 合計 4.2 秒で返すため、こちらを使う。
 */
export const MODEL = "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

export function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY が設定されていません（サーバー環境変数）。");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export type ModeSlug = "gen" | "aca";

export function modeLabel(mode: ModeSlug): string {
  return mode === "aca" ? "学術（Academic）" : "一般";
}

const wordRelation = {
  type: Type.OBJECT,
  properties: {
    word: { type: Type.STRING },
    translation: { type: Type.STRING },
  },
  required: ["word", "translation"],
} as const;

/** WordDetail の構造化出力スキーマ。プロパティの並び順が生成順になる。 */
export const WORD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    // 先に返ってほしい軽い項目を前に置く（ストリーミングで早く表示するため）
    word: { type: Type.STRING },
    meaning: { type: Type.STRING },
    grammar: { type: Type.STRING },
    phonetic: { type: Type.STRING },
    category: { type: Type.STRING },
    nuance: { type: Type.STRING },
    etymology: { type: Type.STRING },
    importanceScore: { type: Type.NUMBER },
    examples: { type: Type.ARRAY, items: { type: Type.STRING } },
    collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
    synonyms: { type: Type.ARRAY, items: wordRelation },
    antonyms: { type: Type.ARRAY, items: wordRelation },
    specializedContexts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          context: { type: Type.STRING },
        },
        required: ["field", "context"],
      },
    },
    etymologyNodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          meaning: { type: Type.STRING },
          root: { type: Type.STRING },
          relation: { type: Type.STRING },
          importance: { type: Type.NUMBER },
        },
        required: ["word", "meaning", "root", "relation", "importance"],
      },
    },
  },
  required: [
    "word", "meaning", "grammar", "phonetic", "category", "nuance", "etymology",
    "importanceScore", "examples", "collocations", "synonyms", "antonyms",
    "specializedContexts", "etymologyNodes",
  ],
} as const;

export function buildLookupPrompt(word: string, mode: ModeSlug): string {
  const context = mode === "gen" ? "general everyday usage" : "academic and research contexts";
  return `Look up the English word "${word}" specifically for ${context}.
Prioritize meanings in ${context}.
Provide:
- meaning: Japanese translation
- grammar: part of speech
- phonetic: IPA pronunciation WITHOUT surrounding slashes (e.g. ˈtɜːbjələns)
- category: professional field (e.g. Mechanical Engineering, Finance, etc.)
- nuance: semantic difference from synonyms, in Japanese
- etymology: origin, in Japanese
- examples: 3 entries, each formatted as "English sentence\\nJapanese translation"
- collocations: 5 common English verb/noun pairings
- synonyms/antonyms: 3 pairs each with Japanese translations
- specializedContexts: 3 fields with concise Japanese usage explanations
- etymologyNodes: words sharing the same root, each with an 'importance' score (0.0-1.0)
- importanceScore: 0.0 to 1.0 overall importance for English/IELTS/Engineering learners.`;
}

/**
 * 思考を最小限にする設定。辞書引きは推論タスクではないので、
 * thinking に時間を使わせるとレイテンシだけが伸びる。
 */
/**
 * 思考を最小化する設定。辞書引きは推論タスクではないので、thinking に
 * 時間を使わせるとレイテンシだけが伸びる。
 *
 * 設定項目がモデル世代で異なる（3系は thinkingLevel、2.5系は thinkingBudget）。
 * 片方を非対応モデルに渡すと 400 になるため、MODEL に応じて切り替える。
 */
export const FAST_THINKING = MODEL.startsWith("gemini-3")
  ? { thinkingLevel: ThinkingLevel.MINIMAL }
  : { thinkingBudget: 0 };
