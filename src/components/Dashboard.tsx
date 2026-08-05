/**
 * 今日のダッシュボード（実装仕様書 F6）。
 *
 * 表示する数値はすべてローカルキャッシュ上の savedWords から計算する。
 * Firestore への追加読み取りは発生しない（streak だけは日跨ぎの判定が
 * 必要なので user_stats に永続化してある）。
 *
 * 区切りは枠ではなく罫線と余白で表す。
 */

import React from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Deck, SavedWord, UserStats } from "../types";
import { computeDeckProgress, computeStats } from "../lib/stats";

interface Props {
  words: SavedWord[];
  decks: Deck[];
  stats: UserStats | null;
  enriching: { remaining: number; running: boolean };
  onStartReview: (scope: "due" | "overdue" | "fresh" | "all") => void;
  onOpenExtract: () => void;
  onSelectDeck: (deckId: string | null) => void;
}

/** 数値ひとつ。押せるものは下線で示す。 */
const Metric: React.FC<{
  value: number;
  label: string;
  onClick?: () => void;
  emphasis?: boolean;
}> = ({ value, label, onClick, emphasis }) => {
  const disabled = !onClick || value === 0;
  const color = emphasis && value > 0 ? "text-red-600" : "text-[#1A1C1E]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left group disabled:cursor-default"
    >
      <div
        className={`text-4xl font-black tabular-nums ${color} ${
          disabled ? "opacity-30" : "group-hover:text-[#2A5CFF] transition-colors"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] font-bold text-[#8A9199] mt-1">{label}</div>
    </button>
  );
};

export const Dashboard: React.FC<Props> = ({
  words,
  decks,
  stats,
  enriching,
  onStartReview,
  onOpenExtract,
  onSelectDeck,
}) => {
  const s = computeStats(words);
  const progress = computeDeckProgress(words, decks);
  const maxDaily = Math.max(1, ...s.weekly.map((d) => d.count));

  if (words.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-full flex flex-col justify-center max-w-xl mx-auto w-full"
      >
        <h2 className="text-3xl font-black text-[#1A1C1E] mb-3">保存された単語はありません</h2>
        <p className="text-[#656E77] text-sm mb-10 leading-relaxed">
          左上の検索から単語を調べるか、英文を貼り付けてまとめて追加できます。
        </p>
        <div>
          <button type="button" onClick={onOpenExtract} className="btn-quiet px-0">
            英文を貼り付けて追加
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto pb-12"
    >
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[#1A1C1E]">今日の学習</h1>
        <p className="text-sm text-[#8A9199] mt-1">
          {s.total} 語を管理中 · 今週 {s.addedThisWeek} 語追加
        </p>
      </div>

      {enriching.remaining > 0 && (
        <p className="mb-10 pl-4 border-l-2 border-[#2A5CFF] text-xs text-[#656E77] flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-[#2A5CFF] animate-spin shrink-0" />
          追加した単語の詳細を生成しています（残り {enriching.remaining} 語）
        </p>
      )}

      <section className="section">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <Metric value={s.dueToday} label="今日の復習" onClick={() => onStartReview("due")} />
          <Metric value={s.overdue} label="期限超過" onClick={() => onStartReview("overdue")} emphasis />
          <Metric value={s.fresh} label="未復習" onClick={() => onStartReview("fresh")} />
          <Metric value={stats?.streak ?? 0} label="連続学習日" />
        </div>

        <div className="flex flex-wrap items-center gap-8 mt-10">
          <button
            type="button"
            onClick={() => onStartReview(s.dueToday > 0 ? "due" : "all")}
            className="btn-primary"
          >
            復習を始める
          </button>
          <button type="button" onClick={onOpenExtract} className="btn-quiet px-0">
            英文から追加
          </button>
        </div>

        {s.overdue > 20 && (
          <p className="mt-10 pl-4 border-l-2 border-[#EAECEF] text-xs text-[#656E77] leading-loose">
            期限を過ぎた単語が {s.overdue} 語あります。一度にすべて復習せず、
            「期限超過」から少しずつ進めることをおすすめします。
          </p>
        )}
      </section>

      <section className="section">
        <h3 className="section-label">直近7日の追加</h3>
        <div className="flex items-end justify-between gap-3 h-24">
          {s.weekly.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-[10px] font-bold text-[#8A9199] tabular-nums">
                {d.count || ""}
              </span>
              <div
                className="w-full bg-[#1A1C1E] transition-all"
                style={{
                  height: `${Math.max(d.count ? 4 : 1, (d.count / maxDaily) * 72)}px`,
                  opacity: d.count ? 1 : 0.12,
                }}
              />
              <span className="text-[10px] text-[#8A9199]">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section-label">デッキ別の定着</h3>

        {progress.length === 0 ? (
          <p className="text-xs text-[#8A9199]">デッキはまだありません。</p>
        ) : (
          <div>
            {progress.map((row) => (
              <button
                key={row.deck?.id ?? "unfiled"}
                onClick={() => onSelectDeck(row.deck?.id ?? null)}
                className="w-full text-left group py-4 border-t border-[#F1F3F5] first:border-t-0 first:pt-0"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs font-bold text-[#1A1C1E] group-hover:text-[#2A5CFF] transition-colors">
                    {row.deck?.name ?? "未分類"}
                  </span>
                  <span className="text-[11px] text-[#8A9199] tabular-nums">
                    {Math.round(row.retained * 100)}% · {row.total} 語
                  </span>
                </div>
                <div className="h-0.5 bg-[#F1F3F5]">
                  <div
                    className="h-0.5 transition-all"
                    style={{
                      width: `${row.retained * 100}%`,
                      backgroundColor: row.deck?.color ?? "#1A1C1E",
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
};
