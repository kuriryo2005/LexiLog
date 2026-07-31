/**
 * 読み取り時のデータ正規化。
 *
 * 方針（実装仕様書 §1 鉄則 R3）:
 * Firestore から読んだデータは必ずここを通し、v1 / v2 いずれの形式でも
 * 同じ内部型として扱えるようにする。Firestore 上の既存ドキュメントは書き換えない。
 *
 * Phase 0 では例文の正規化のみを提供する。
 * Phase 2 で normalizeWord() を追加してここに集約する。
 */

export interface ExamplePair {
  en: string;
  ja: string;
}

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
