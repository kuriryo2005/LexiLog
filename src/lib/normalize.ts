/**
 * 読み取り時のデータ正規化。
 *
 * 方針（実装仕様書 §1 鉄則 R3）:
 * Firestore から読んだデータは必ずここを通し、v1 / v2 いずれの形式でも
 * 同じ内部型として扱えるようにする。Firestore 上の既存ドキュメントは書き換えない。
 *
 * Firestore から読んだ単語は例外なく normalizeWord() を通してから state に入れる。
 * これにより v1 のドキュメントを1件も書き換えずに v2 のフィールドを前提とした
 * コードが書ける。
 */

import type { SavedWord, ExamplePair } from "../types";

export type { ExamplePair };

/**
 * 例文を { en, ja } に正規化する。
 *
 * 保存形式は "英文\n和訳" の文字列（v1）。将来 { en, ja } で保存する場合に備えて
 * オブジェクト形式も受け付ける。保存形式自体は Phase 0 では変更しない。
 */
export function normalizeExamples(examples: unknown): ExamplePair[] {
  if (!Array.isArray(examples)) return [];

  return examples.map((raw) => {
    if (raw && typeof raw === "object" && "en" in (raw as object)) {
      const obj = raw as { en?: unknown; ja?: unknown };
      return { en: String(obj.en ?? ""), ja: String(obj.ja ?? "") };
    }
    const [en = "", ja = ""] = String(raw ?? "").split("\n");
    return { en: en.trim(), ja: ja.trim() };
  });
}

/** 単語の重複判定・検索に使う正規化キー。 */
export function toWordLower(word: unknown): string {
  return String(word ?? "").trim().toLowerCase();
}

/** モードを ASCII のスラッグに変換する（Firestore のドキュメントID制約対応）。 */
export function toModeSlug(mode: unknown): "gen" | "aca" {
  return String(mode ?? "") === "学術（Academic）" ? "aca" : "gen";
}

function arr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Firestore の1ドキュメントを SavedWord に正規化する（実装仕様書 §2.5）。
 *
 * 既存の43件は schemaVersion を持たない v1 で、mode すら無いものもある。
 * ここで欠けているフィールドを埋めることで、呼び出し側は
 * word.tags や word.examplePairs が常に存在する前提で書ける。
 *
 * **Firestore 側には一切書き戻さない。** 読み取り時の変換に閉じる（鉄則 R2）。
 */
export function normalizeWord(id: string, raw: Record<string, any>): SavedWord {
  const word = String(raw?.word ?? "");
  return {
    ...raw,
    id,
    word,
    meaning: String(raw?.meaning ?? ""),
    grammar: String(raw?.grammar ?? ""),
    etymology: String(raw?.etymology ?? ""),
    nuance: String(raw?.nuance ?? ""),
    category: String(raw?.category ?? ""),
    timestamp: typeof raw?.timestamp === "number" ? raw.timestamp : 0,
    schemaVersion: typeof raw?.schemaVersion === "number" ? raw.schemaVersion : 1,
    wordLower: raw?.wordLower ?? toWordLower(word),
    tags: arr(raw?.tags).map((t) => String(t)),
    deckId: raw?.deckId ?? null,
    phonetic: raw?.phonetic ? String(raw.phonetic) : undefined,
    examples: arr(raw?.examples),
    collocations: arr(raw?.collocations),
    synonyms: arr(raw?.synonyms),
    antonyms: arr(raw?.antonyms),
    specializedContexts: arr(raw?.specializedContexts),
    etymologyNodes: arr(raw?.etymologyNodes),
    reviewHistory: arr(raw?.reviewHistory),
    // 旧データは詳細が揃っているので done 扱い（F5 の一括取り込みだけが pending を作る）
    enrichStatus:
      raw?.enrichStatus === "pending" || raw?.enrichStatus === "error" ? raw.enrichStatus : "done",
    importanceScore: typeof raw?.importanceScore === "number" ? raw.importanceScore : 0.5,
    examplePairs: normalizeExamples(raw?.examples),
  } as SavedWord;
}

/**
 * ストリーミング途中の部分的な結果を、UI が安全に描画できる形に埋める。
 *
 * 生成中は配列や文字列がまだ存在しないため、そのまま渡すと
 * result.examples.map(...) のような箇所で落ちる。
 */
export function coerceWordDetail(partial: Record<string, any>): any {
  return {
    word: String(partial.word ?? ""),
    meaning: String(partial.meaning ?? ""),
    grammar: String(partial.grammar ?? ""),
    phonetic: partial.phonetic ? String(partial.phonetic) : undefined,
    category: String(partial.category ?? ""),
    nuance: String(partial.nuance ?? ""),
    etymology: String(partial.etymology ?? ""),
    importanceScore: typeof partial.importanceScore === "number" ? partial.importanceScore : 0.5,
    examples: arr(partial.examples),
    collocations: arr(partial.collocations),
    synonyms: arr(partial.synonyms),
    antonyms: arr(partial.antonyms),
    specializedContexts: arr(partial.specializedContexts),
    etymologyNodes: arr(partial.etymologyNodes),
    ...(partial.mode ? { mode: partial.mode } : {}),
  };
}
