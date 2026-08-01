/**
 * ダッシュボードの集計（実装仕様書 F6）。
 *
 * すべてローカルキャッシュ上の savedWords から計算する。Firestore への
 * 追加読み取りは発生しない。日付境界は UTC ではなく**ローカルタイムの 0:00**。
 */

import { endOfDay, format, startOfDay, subDays } from "date-fns";
import { Deck, SavedWord, UserStats } from "../types";

export interface DashboardStats {
  total: number;
  /** 今日中に期限が来るもの（期限超過を含む） */
  dueToday: number;
  /** 昨日以前に期限が過ぎたもの */
  overdue: number;
  /** 一度も復習していないもの */
  fresh: number;
  addedThisWeek: number;
  /** 直近7日の保存数（古い日 → 今日の順） */
  weekly: { date: string; label: string; count: number }[];
  pending: number;
}

export function computeStats(words: SavedWord[], now = new Date()): DashboardStats {
  const dayStart = startOfDay(now).getTime();
  const dayEnd = endOfDay(now).getTime();
  const weekAgo = subDays(startOfDay(now), 6).getTime();

  let dueToday = 0;
  let overdue = 0;
  let fresh = 0;
  let addedThisWeek = 0;
  let pending = 0;

  const buckets = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    buckets.set(format(subDays(now, i), "yyyy-MM-dd"), 0);
  }

  for (const w of words) {
    if (w.nextReviewAt == null) fresh++;
    else if (w.nextReviewAt < dayStart) overdue++;
    else if (w.nextReviewAt <= dayEnd) dueToday++;

    if (w.enrichStatus === "pending") pending++;

    if (w.timestamp >= weekAgo) {
      addedThisWeek++;
      const key = format(w.timestamp, "yyyy-MM-dd");
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return {
    total: words.length,
    // 期限超過も「今日やるべきもの」に含める（別々に数えると合計が合わなくなる）
    dueToday: dueToday + overdue,
    overdue,
    fresh,
    addedThisWeek,
    weekly: [...buckets.entries()].map(([date, count]) => ({
      date,
      label: format(new Date(`${date}T00:00:00`), "M/d"),
      count,
    })),
    pending,
  };
}

export interface DeckProgress {
  deck: Deck | null; // null = 未分類
  total: number;
  /** 期限が来ていない = 覚えている状態にあるものの割合（0〜1） */
  retained: number;
}

export function computeDeckProgress(
  words: SavedWord[],
  decks: Deck[],
  now = Date.now()
): DeckProgress[] {
  const byDeck = new Map<string | null, SavedWord[]>();
  for (const w of words) {
    const key = w.deckId ?? null;
    const list = byDeck.get(key);
    if (list) list.push(w);
    else byDeck.set(key, [w]);
  }

  const rows: DeckProgress[] = decks.map((deck) => {
    const list = byDeck.get(deck.id) ?? [];
    return { deck, ...ratio(list, now) };
  });

  const unfiled = byDeck.get(null) ?? [];
  if (unfiled.length > 0) rows.push({ deck: null, ...ratio(unfiled, now) });

  return rows;
}

function ratio(list: SavedWord[], now: number): { total: number; retained: number } {
  if (list.length === 0) return { total: 0, retained: 0 };
  const ok = list.filter((w) => w.nextReviewAt != null && w.nextReviewAt > now).length;
  return { total: list.length, retained: ok / list.length };
}

/**
 * 連続学習日数を更新した結果を返す（保存は呼び出し側）。
 *
 * 同じ日に2回目以降の復習をしても増えない。前日に学習していれば +1、
 * 間が空いていれば 1 に戻す。
 */
export function nextStreak(stats: UserStats | null, now = new Date()): UserStats {
  const today = format(now, "yyyy-MM-dd");
  const yesterday = format(subDays(now, 1), "yyyy-MM-dd");
  const prev = stats?.streak ?? 0;

  let streak: number;
  if (stats?.lastStudiedOn === today) streak = prev || 1;
  else if (stats?.lastStudiedOn === yesterday) streak = prev + 1;
  else streak = 1;

  return {
    userId: stats?.userId ?? "",
    lastStudiedOn: today,
    streak,
    longestStreak: Math.max(stats?.longestStreak ?? 0, streak),
    updatedAt: Date.now(),
  };
}
