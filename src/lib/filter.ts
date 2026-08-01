/**
 * デッキ / タグによる絞り込み（実装仕様書 F7）。
 *
 * 純粋関数だけを置く。サイドバー・復習キュー・ナレッジマップが同じ関数を通すことで、
 * 「一覧では絞れているのに復習には全部出てくる」というズレを防ぐ。
 */

import { SavedWord, WordFilter } from "../types";

const STORAGE_KEY = "cortex_dict_filter";

export const EMPTY_FILTER: WordFilter = { tags: [] };

export function isFilterActive(filter: WordFilter): boolean {
  return filter.deckId !== undefined || filter.tags.length > 0;
}

/** タグ名の正規化。前後の空白を落とし、比較は小文字で行う。 */
export function normalizeTag(tag: string): string {
  return tag.trim().slice(0, 32);
}

export function sameTag(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 大小文字を区別せずに重複を除く。表示は最初に現れた表記を残す。 */
export function dedupeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    if (!out.some((t) => sameTag(t, tag))) out.push(tag);
  }
  return out.slice(0, 10);
}

/**
 * 絞り込みを適用する。
 * deckId が undefined ならデッキ条件なし、null なら「未分類のみ」。
 * tags は複数指定で AND。
 */
export function applyFilter(words: SavedWord[], filter: WordFilter): SavedWord[] {
  if (!isFilterActive(filter)) return words;

  return words.filter((w) => {
    if (filter.deckId !== undefined) {
      const deckId = w.deckId ?? null;
      if (deckId !== filter.deckId) return false;
    }
    if (filter.tags.length > 0) {
      const own = w.tags ?? [];
      if (!filter.tags.every((t) => own.some((o) => sameTag(o, t)))) return false;
    }
    return true;
  });
}

/** 全単語から使用中のタグを集計する（サジェスト・フィルタ候補用）。 */
export function collectTags(words: SavedWord[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const w of words) {
    for (const raw of w.tags ?? []) {
      const tag = normalizeTag(raw);
      if (!tag) continue;
      const key = tag.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function loadFilter(): WordFilter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw);
    return {
      deckId: parsed?.deckId === undefined ? undefined : parsed.deckId,
      tags: Array.isArray(parsed?.tags) ? parsed.tags.map(String) : [],
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export function saveFilter(filter: WordFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // 保存できなくても絞り込み自体は動く
  }
}
