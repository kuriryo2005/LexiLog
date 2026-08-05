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

import type { SavedWord, ExamplePair, Sense, TargetPhrase, Derivative } from "../types";

export type { ExamplePair };

/** 保存済みドキュメントがこの版以上なら、単語帳用の項目が AI 由来で入っている。 */
export const TARGET_SCHEMA_VERSION = 3;

/**
 * 番号付きの語義。
 *
 * v3 より前のドキュメントには senses が無いので、meaning を「；」で割って作る。
 * 43件の既存データを書き換えずに紙面へ載せるための橋渡し（鉄則 R3）。
 */
export function normalizeSenses(raw: unknown, meaning: string): Sense[] {
  if (Array.isArray(raw)) {
    const senses = raw
      .map((s) => {
        if (s && typeof s === "object") {
          const o = s as { ja?: unknown; pos?: unknown };
          return { ja: String(o.ja ?? "").trim(), pos: o.pos ? String(o.pos) : undefined };
        }
        return { ja: String(s ?? "").trim() };
      })
      .filter((s) => s.ja);

    if (senses.length > 0) return senses;
  }

  return String(meaning ?? "")
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((ja) => ({ ja }));
}

/** `change one's life「〜の人生を変える」` のような1行を型と訳に割る。 */
function parsePhraseLine(line: string): TargetPhrase | null {
  const text = String(line ?? "").trim();
  if (!text) return null;

  const matched = text.match(/^(.*?)\s*[「『]([^」』]*)[」』]\s*$/);
  if (matched) {
    const en = matched[1].trim();
    return en ? { en, ja: matched[2].trim() } : null;
  }

  // 訳が付いていない collocation はそのまま型として扱う
  return { en: text, ja: "" };
}

/**
 * ターゲットフレーズ。
 * v3 より前は collocations（文字列の配列）しか無いので、そこから組み立てる。
 */
export function normalizeTargetPhrases(raw: unknown, collocations: unknown): TargetPhrase[] {
  if (Array.isArray(raw)) {
    const phrases = raw
      .map((p) => {
        if (p && typeof p === "object") {
          const o = p as { en?: unknown; ja?: unknown };
          return { en: String(o.en ?? "").trim(), ja: String(o.ja ?? "").trim() };
        }
        return parsePhraseLine(String(p ?? ""));
      })
      .filter((p): p is TargetPhrase => !!p && !!p.en);

    if (phrases.length > 0) return phrases;
  }

  return (Array.isArray(collocations) ? collocations : [])
    .map((c) => parsePhraseLine(String(c ?? "")))
    .filter((p): p is TargetPhrase => !!p && !!p.en);
}

export function normalizeDerivatives(raw: unknown): Derivative[] {
  return (Array.isArray(raw) ? raw : [])
    .map((d) => {
      if (!d || typeof d !== "object") return null;
      const o = d as { word?: unknown; pos?: unknown; meaning?: unknown };
      const word = String(o.word ?? "").trim();
      return word
        ? { word, pos: String(o.pos ?? "").trim(), meaning: String(o.meaning ?? "").trim() }
        : null;
    })
    .filter((d): d is Derivative => d !== null);
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
  const meaning = String(raw?.meaning ?? "");

  return {
    ...raw,
    id,
    word,
    meaning,
    // 単語帳用。v3 未満のドキュメントは meaning / collocations から組み立てる
    senses: normalizeSenses(raw?.senses, meaning),
    targetPhrases: normalizeTargetPhrases(raw?.targetPhrases, raw?.collocations),
    derivatives: normalizeDerivatives(raw?.derivatives),
    examLevel: raw?.examLevel ? String(raw.examLevel) : undefined,
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
    senses: normalizeSenses(partial.senses, String(partial.meaning ?? "")),
    targetPhrases: normalizeTargetPhrases(partial.targetPhrases, partial.collocations),
    derivatives: normalizeDerivatives(partial.derivatives),
    examLevel: partial.examLevel ? String(partial.examLevel) : undefined,
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
