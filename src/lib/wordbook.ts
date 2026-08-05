/**
 * 紙の単語帳（見開き）を組むためのロジック。
 *
 * 設計の軸は 4 つ。
 *  A 復習スケジュールを紙面に埋め込む（Day1/3/7/21 のチェック枠）
 *  B 進捗を物理的に見せる（到達マップ・ここまでで◯語）
 *  C 例文を二段構えにする（短フレーズ＝想起用／自然文＝ニュアンス確認用）
 *  D 見開き完結・余白多め（1 見開き＝1 セッション）
 *
 * 単語の並びは timestamp の昇順で固定する。降順だと新しい語を足すたびに
 * 全ユニットの構成がずれ、紙に印刷したチェック欄が意味を失うため。
 */

import { SavedWord } from "../types";

/** 1 見開きに載せる語数。写真の紙面と同じ 7 語。 */
export const WORDS_PER_UNIT = 7;

/** 紙面に印刷する復習日（初回学習日からの経過日数）。 */
export const REVIEW_DAYS = [1, 3, 7, 21] as const;

export type ReviewDay = (typeof REVIEW_DAYS)[number];

const CHECK_KEY = "cortex_dict_wordbook_checks";
const START_KEY = "cortex_dict_wordbook_started";

export interface Unit {
  /** 通し番号（0 始まり） */
  index: number;
  /** 表示用のユニット番号（1 始まり、0 埋め 2 桁） */
  label: string;
  words: SavedWord[];
  /** 先頭語の id。ユニットの同一性の鍵。 */
  unitId: string;
  /** このユニットの最終語までの通算語数（B の「ここまでで◯語」） */
  cumulative: number;
  /** 全体の何語目から何語目か */
  from: number;
  to: number;
}

/**
 * 単語をユニット（見開き）に分ける。
 *
 * unitId に先頭語の id を使うのは、末尾に語が増えても既存ユニットの
 * 鍵が変わらないようにするため。途中の語を消すと以降がずれるが、
 * それは紙の本でも同じことなので許容する。
 */
export function buildUnits(words: SavedWord[]): Unit[] {
  const sorted = [...words].sort((a, b) => a.timestamp - b.timestamp);
  const units: Unit[] = [];

  for (let i = 0; i < sorted.length; i += WORDS_PER_UNIT) {
    const chunk = sorted.slice(i, i + WORDS_PER_UNIT);
    const index = units.length;
    units.push({
      index,
      label: String(index + 1).padStart(2, "0"),
      words: chunk,
      unitId: chunk[0]?.id ?? `unit-${index}`,
      cumulative: i + chunk.length,
      from: i + 1,
      to: i + chunk.length,
    });
  }

  return units;
}

// --- A: 復習チェックの保存 -------------------------------------------------

/** unitId -> チェック済みの日数の配列 */
export type WordbookChecks = Record<string, number[]>;

/**
 * チェックは localStorage に置く。
 * Firestore に新しいフィールドを足すとセキュリティルールの再適用が要るが、
 * この印はあくまで紙面の代替で、端末をまたぐ必要が薄いため。
 */
export function loadChecks(): WordbookChecks {
  try {
    const raw = localStorage.getItem(CHECK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const out: WordbookChecks = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[key] = value.filter((d): d is number => typeof d === "number");
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveChecks(checks: WordbookChecks): void {
  try {
    localStorage.setItem(CHECK_KEY, JSON.stringify(checks));
  } catch {
    /* 容量超過などは無視する。印が消えるだけで学習は続けられる。 */
  }
}

export function toggleCheck(checks: WordbookChecks, unitId: string, day: number): WordbookChecks {
  const current = checks[unitId] ?? [];
  const next = current.includes(day)
    ? current.filter((d) => d !== day)
    : [...current, day].sort((a, b) => a - b);

  return { ...checks, [unitId]: next };
}

/** 見出し語ごとのチェック枠の数（紙面の □□）。 */
export const WORD_CHECK_SLOTS = 2;

const WORD_CHECK_KEY = "cortex_dict_wordbook_word_checks";

export function loadWordChecks(): WordbookChecks {
  try {
    const raw = localStorage.getItem(WORD_CHECK_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};

    const out: WordbookChecks = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) out[key] = value.filter((n): n is number => typeof n === "number");
    }
    return out;
  } catch {
    return {};
  }
}

export function saveWordChecks(checks: WordbookChecks): void {
  try {
    localStorage.setItem(WORD_CHECK_KEY, JSON.stringify(checks));
  } catch {
    /* 同上 */
  }
}

/** 括弧の中身が助詞だけかどうか。「(を)」は訳の一部、「(人)」は目的語の注記。 */
const PARTICLE_ONLY = /^[をにがはでとへのもや・]+$/;

export interface SenseParts {
  /** 目的語の注記など、赤シートで隠さない部分 */
  lead: string;
  /** 覚える対象。紙面ではマゼンタの太字 */
  core: string;
}

/**
 * 語義①を「注記」と「覚える対象」に分ける。
 *
 *   (人)を手伝う，助ける  →  lead "(人)" / core "を手伝う，助ける"
 *   (を)学ぶ              →  lead ""     / core "(を)学ぶ"
 *
 * 紙面では core だけが色付きの太字になり、赤シートで隠せる範囲になる。
 */
export function splitPrimarySense(ja: string): SenseParts {
  const text = (ja ?? "").trim();
  const matched = text.match(/^[（(]([^）)]*)[）)]/);

  if (matched && !PARTICLE_ONLY.test(matched[1])) {
    return { lead: matched[0], core: text.slice(matched[0].length) };
  }
  return { lead: "", core: text };
}

/** 語義の頭に付く格助詞。括弧付きの「(を)」も含む。 */
const LEADING_PARTICLE = /^[（(]?[をにがへと][）)]?/;

/**
 * 語義の頭の助詞を切り出す。
 *
 * 紙面では「を変える」の「を」だけが本体より小さい字で組まれている。
 * 助詞と内容語の見た目の差が、語義の読み取りやすさを作っている。
 */
export function splitParticle(ja: string): { particle: string; rest: string } {
  const text = (ja ?? "").trim();
  const matched = text.match(LEADING_PARTICLE);
  return matched
    ? { particle: matched[0], rest: text.slice(matched[0].length) }
    : { particle: "", rest: text };
}

/** ユニットの学習開始日（Day1 の起点）。初回チェック時に記録する。 */
export function loadStartDates(): Record<string, number> {
  try {
    const raw = localStorage.getItem(START_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStartDates(dates: Record<string, number>): void {
  try {
    localStorage.setItem(START_KEY, JSON.stringify(dates));
  } catch {
    /* 同上 */
  }
}

/**
 * 復習日の実日付。開始日が未記録なら、そのユニットの最初の語を
 * 保存した日を起点にする（本を開いた時点で予定が見えるように）。
 */
export function reviewDate(startedAt: number, day: number): Date {
  const d = new Date(startedAt);
  d.setDate(d.getDate() + day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// --- C / 表示の補助 --------------------------------------------------------

/** 品詞を 1 文字の記号にする。写真の 動 / 名 バッジに相当。 */
export function posBadge(grammar: string): string {
  const g = (grammar ?? "").trim();
  if (!g) return "語";

  const table: [RegExp, string][] = [
    [/動詞|\bverb\b|^v\b/i, "動"],
    [/名詞|\bnoun\b|^n\b/i, "名"],
    [/形容詞|\badjective\b|^adj/i, "形"],
    [/副詞|\badverb\b|^adv/i, "副"],
    [/前置詞|\bpreposition\b|^prep/i, "前"],
    [/接続詞|\bconjunction\b|^conj/i, "接"],
    [/代名詞|\bpronoun\b|^pron/i, "代"],
    [/助動詞|\bauxiliary\b/i, "助"],
    [/熟語|\bidiom\b|\bphrase\b/i, "熟"],
  ];

  for (const [pattern, badge] of table) {
    if (pattern.test(g)) return badge;
  }
  return g.slice(0, 1);
}

/** 語義を ①② に分ける。写真の番号付き語義に相当。 */
export function splitSenses(meaning: string): string[] {
  const senses = (meaning ?? "")
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return senses.length > 0 ? senses : [(meaning ?? "").trim()].filter(Boolean);
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(s: string): string {
  return s.replace(ESCAPE, "\\$&");
}

/**
 * 英文中の対象語を見つける。changed / lived / helped のような
 * 活用形も拾う（写真では見出し語が赤字になっている）。
 */
export function targetPattern(word: string): RegExp | null {
  const w = (word ?? "").trim().toLowerCase();
  if (!w || /[^a-z' -]/.test(w)) return null;

  const alts = [`${escapeRegExp(w)}(?:s|es|ed|d|ing)?`];
  if (w.endsWith("e")) alts.push(`${escapeRegExp(w.slice(0, -1))}(?:ing|ed)`);
  if (w.endsWith("y")) alts.push(`${escapeRegExp(w.slice(0, -1))}(?:ied|ies)`);

  try {
    return new RegExp(`\\b(${alts.join("|")})\\b`, "gi");
  } catch {
    return null;
  }
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/** 英文を「対象語」と「それ以外」に切り分ける。 */
export function splitByTarget(sentence: string, word: string): TextPart[] {
  const pattern = targetPattern(word);
  if (!pattern || !sentence) return [{ text: sentence ?? "", hit: false }];

  const parts: TextPart[] = [];
  let last = 0;

  for (const match of sentence.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: sentence.slice(last, at), hit: false });
    parts.push({ text: match[0], hit: true });
    last = at + match[0].length;
  }

  if (last < sentence.length) parts.push({ text: sentence.slice(last), hit: false });
  return parts.length > 0 ? parts : [{ text: sentence, hit: false }];
}

const KANJI = /[一-鿿々]/;
const HIRAGANA = /[ぁ-ゟ]/;

function coreCandidates(meaning: string): string[] {
  return splitSenses(meaning)
    .map((s) => s.replace(/[（(][^）)]*[）)]/g, ""))
    .map((s) => s.replace(/^[をにがはでとへのもか、・\s]+/, ""))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 和訳のうち、語義に対応する範囲を推定する。
 *
 * 語義「を変える」と和訳「この本は私の人生を変えた。」から「変えた」を得る。
 * 漢字を含む最長の共通部分を起点に、後ろに続くひらがな（活用語尾）まで伸ばす。
 * 完全ではないので、見つからなければ何も色を付けない。
 */
export function findJaSpan(ja: string, meaning: string): [number, number] | null {
  if (!ja) return null;
  let best: [number, number] | null = null;

  for (const candidate of coreCandidates(meaning)) {
    let found: [number, number] | null = null;

    for (let len = candidate.length; len >= 1 && !found; len--) {
      for (let i = 0; i + len <= candidate.length; i++) {
        const sub = candidate.slice(i, i + len);
        if (!KANJI.test(sub)) continue;

        const at = ja.indexOf(sub);
        if (at < 0) continue;

        let end = at + len;

        // 語幹だけが一致したときに限り、活用語尾を取り込む。
        // 語義がそのまま現れているなら伸ばす必要はない
        // （「頼む」がそのまま出ているのに「頼むことにするよ」まで塗らない）。
        if (len < candidate.length) {
          const limit = Math.min(ja.length, end + 6);
          while (end < limit && HIRAGANA.test(ja[end])) {
            const ch = ja[end];
            end++;
            // 「〜て／〜で」は節の切れ目。後ろが続くならそこで止める
            // （「手伝って」＋「くれた」を巻き込まない）。
            if ((ch === "て" || ch === "で") && end < ja.length && HIRAGANA.test(ja[end])) break;
          }
        }

        found = [at, end];
        break;
      }
    }

    if (found && (!best || found[1] - found[0] > best[1] - best[0])) best = found;
  }

  return best;
}

/** 和訳を「語義に対応する部分」と「それ以外」に切り分ける。 */
export function splitJaByMeaning(ja: string, meaning: string): TextPart[] {
  const span = findJaSpan(ja, meaning);
  if (!span) return [{ text: ja ?? "", hit: false }];

  const [start, end] = span;
  const parts: TextPart[] = [];
  if (start > 0) parts.push({ text: ja.slice(0, start), hit: false });
  parts.push({ text: ja.slice(start, end), hit: true });
  if (end < ja.length) parts.push({ text: ja.slice(end), hit: false });
  return parts;
}

/**
 * 和訳の色付けに使う語義の文字列。
 *
 * meaning ではなく senses を優先する。v3 の meaning は「を変える；変わる」と
 * 短いのに対し、例文の和訳は語義①の言い回し（「変更する」など）に沿うため、
 * senses を使わないと対応部分を取り逃がす。
 */
export function meaningSource(word: SavedWord): string {
  const senses = (word.senses ?? []).map((s) => s.ja).filter(Boolean);
  return senses.length > 0 ? senses.join("；") : word.meaning ?? "";
}

/** 自然文（ニュアンス確認用）。 */
export function sentenceOf(word: SavedWord): { en: string; ja: string } | null {
  const pair = (word.examplePairs ?? []).find((p) => p.en?.trim());
  return pair ? { en: pair.en.trim(), ja: (pair.ja ?? "").trim() } : null;
}
