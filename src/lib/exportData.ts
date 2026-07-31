/**
 * データのエクスポート（実装仕様書 F8）。
 *
 * 重要:
 * バックアップとしての忠実性を担保するため、React の state ではなく
 * Firestore から取り直した生データを書き出す。state 側は将来 normalize を
 * 通す予定があり、正規化で補われた値がバックアップに混入するのを避ける。
 */

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { normalizeExamples } from "./normalize";

export const EXPORT_FORMAT_VERSION = 1;

export type ExportFormat = "json" | "csv" | "anki";

export interface ExportBundle {
  app: "cortex-dictionary";
  formatVersion: number;
  exportedAt: number;
  uid: string;
  counts: { words: number; decks: number };
  decks: Record<string, unknown>[];
  words: Record<string, unknown>[];
}

/** Firestore から生のドキュメントを取得する。 */
export async function fetchRawWords(uid: string): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(query(collection(db, "words"), where("userId", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * デッキを取得する。Phase 4 で decks コレクションを導入するまでは常に空配列。
 * ルール未定義の状態で読むと権限エラーになるため、失敗しても空配列で続行する。
 */
async function fetchRawDecks(uid: string): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(query(collection(db, "decks"), where("userId", "==", uid)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function buildExportBundle(uid: string): Promise<ExportBundle> {
  const [words, decks] = await Promise.all([fetchRawWords(uid), fetchRawDecks(uid)]);
  return {
    app: "cortex-dictionary",
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    uid,
    counts: { words: words.length, decks: decks.length },
    decks,
    words,
  };
}

// --- 整形ヘルパー ---------------------------------------------------------

function isoLocal(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  );
}

function joinList(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .map((item) => {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        if ("word" in o) return `${o.word}${o.translation ? ` (${o.translation})` : ""}`;
        if ("field" in o) return `[${o.field}] ${o.context ?? ""}`;
        return JSON.stringify(o);
      }
      return String(item ?? "");
    })
    .join("; ");
}

/** RFC4180 に従ったフィールドのエスケープ。 */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- 各形式の生成 ---------------------------------------------------------

export function toJsonBlob(bundle: ExportBundle): Blob {
  return new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json;charset=utf-8",
  });
}

const CSV_COLUMNS = [
  "word", "phonetic", "meaning", "grammar", "category", "mode", "deck", "tags",
  "nuance", "etymology",
  "example_en_1", "example_ja_1", "example_en_2", "example_ja_2", "example_en_3", "example_ja_3",
  "synonyms", "antonyms", "collocations",
  "importanceScore", "nextReviewAt", "reviewCount", "savedAt",
] as const;

export function toCsvBlob(
  bundle: ExportBundle,
  deckNameById: Map<string, string> = new Map()
): Blob {
  const rows: string[] = [CSV_COLUMNS.join(",")];

  for (const w of bundle.words) {
    const ex = normalizeExamples(w.examples);
    const reviewHistory = Array.isArray(w.reviewHistory) ? w.reviewHistory : [];
    const deckId = typeof w.deckId === "string" ? w.deckId : "";

    const cells: unknown[] = [
      w.word, w.phonetic, w.meaning, w.grammar, w.category, w.mode,
      deckId ? deckNameById.get(deckId) ?? deckId : "",
      Array.isArray(w.tags) ? w.tags.join("; ") : "",
      w.nuance, w.etymology,
      ex[0]?.en, ex[0]?.ja, ex[1]?.en, ex[1]?.ja, ex[2]?.en, ex[2]?.ja,
      joinList(w.synonyms), joinList(w.antonyms), joinList(w.collocations),
      w.importanceScore, isoLocal(w.nextReviewAt), reviewHistory.length, isoLocal(w.timestamp),
    ];

    rows.push(cells.map(csvCell).join(","));
  }

  // Excel が UTF-8 と判別できるよう BOM を付ける
  return new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
}

function htmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Anki 用 TSV。タブと改行はフィールド区切りになるため必ず除去する。 */
export function toAnkiBlob(
  bundle: ExportBundle,
  deckNameById: Map<string, string> = new Map()
): Blob {
  const clean = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
  const rows: string[] = [];

  for (const w of bundle.words) {
    const ex = normalizeExamples(w.examples);
    const phonetic = w.phonetic ? ` <span class="ipa">/${htmlEscape(w.phonetic)}/</span>` : "";
    const front = clean(`${htmlEscape(w.word)}${phonetic}`);

    const backParts = [
      `<b>${htmlEscape(w.meaning)}</b>`,
      w.grammar ? `<i>${htmlEscape(w.grammar)}</i>` : "",
      w.nuance ? `<div class="nuance">${htmlEscape(w.nuance)}</div>` : "",
      ex[0] ? `<div class="ex">${htmlEscape(ex[0].en)}<br>${htmlEscape(ex[0].ja)}</div>` : "",
    ].filter(Boolean);
    const back = clean(backParts.join("<br>"));

    const deckId = typeof w.deckId === "string" ? w.deckId : "";
    const tagSource = [
      deckId ? deckNameById.get(deckId) ?? deckId : "",
      ...(Array.isArray(w.tags) ? w.tags.map(String) : []),
    ].filter(Boolean);
    // Anki のタグは空白区切りなので、タグ内の空白は _ に置換する
    const tags = clean(tagSource.map((t) => t.replace(/\s+/g, "_")).join(" "));

    rows.push([front, back, tags].join("\t"));
  }

  return new Blob(["﻿" + rows.join("\r\n")], { type: "text/tab-separated-values;charset=utf-8" });
}

// --- ダウンロード ---------------------------------------------------------

export function exportFileName(format: ExportFormat, at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  if (format === "json") return `cortex-dictionary_${date}.json`;
  if (format === "csv") return `cortex-dictionary_${date}.csv`;
  return `cortex-dictionary_${date}_anki.tsv`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke を遅延させないと Firefox でダウンロードが中断されることがある
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
