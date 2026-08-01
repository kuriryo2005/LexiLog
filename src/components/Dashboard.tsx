/**
 * 今日のダッシュボード（実装仕様書 F6）。
 *
 * 表示する数値はすべてローカルキャッシュ上の savedWords から計算する。
 * Firestore への追加読み取りは発生しない（streak だけは日跨ぎの判定が
 * 必要なので user_stats に永続化してある）。
 */

import React from "react";
import { motion } from "motion/react";
import { Flame, Layers, Sparkles, ClipboardPaste, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
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
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto"
      >
        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/10 mb-8">
          <Sparkles className="w-8 h-8 text-[#2A5CFF]" />
        </div>
        <h2 className="text-3xl font-black text-[#1A1C1E] mb-3">まず1語調べてみましょう</h2>
        <p className="text-[#656E77] text-sm mb-10">
          左上の検索から単語を引くか、英文をまとめて貼り付けて単語を集められます。
        </p>
        <Button
          onClick={onOpenExtract}
          className="h-12 px-6 rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold"
        >
          <ClipboardPaste className="w-4 h-4 mr-2" />
          英文を貼り付けて単語を集める
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto pb-12"
    >
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[#1A1C1E]">今日の学習</h1>
        <p className="text-sm text-[#656E77] mt-1">
          {s.total} 語を管理中 · 今週 {s.addedThisWeek} 語追加
        </p>
      </div>

      {enriching.remaining > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-[#F0F4FF] border border-[#2A5CFF]/15 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-[#2A5CFF] animate-spin" />
          <p className="text-xs font-bold text-[#2A5CFF]">
            取り込んだ単語の詳細を生成中です（残り {enriching.remaining} 語）
          </p>
        </div>
      )}

      {/* 今日やること */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <button
          onClick={() => onStartReview("due")}
          disabled={s.dueToday === 0}
          className="text-left p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:border-[#2A5CFF]/40 transition-colors disabled:opacity-50 disabled:hover:border-[#E5E7EB]"
        >
          <div className="text-3xl font-black text-[#2A5CFF]">{s.dueToday}</div>
          <div className="text-[10px] font-black uppercase tracking-widest text-[#656E77] mt-1">
            今日の復習
          </div>
        </button>

        <button
          onClick={() => onStartReview("overdue")}
          disabled={s.overdue === 0}
          className={`text-left p-5 rounded-2xl border transition-colors ${
            s.overdue > 0
              ? "bg-red-50 border-red-100 hover:border-red-300"
              : "bg-white border-[#E5E7EB] opacity-50"
          }`}
        >
          <div className={`text-3xl font-black ${s.overdue > 0 ? "text-red-600" : "text-[#656E77]"}`}>
            {s.overdue}
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-[#656E77] mt-1">
            期限超過
          </div>
        </button>

        <button
          onClick={() => onStartReview("fresh")}
          disabled={s.fresh === 0}
          className="text-left p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:border-[#2A5CFF]/40 transition-colors disabled:opacity-50 disabled:hover:border-[#E5E7EB]"
        >
          <div className="text-3xl font-black text-[#1A1C1E]">{s.fresh}</div>
          <div className="text-[10px] font-black uppercase tracking-widest text-[#656E77] mt-1">
            新規カード
          </div>
        </button>

        <div className="p-5 rounded-2xl bg-orange-50 border border-orange-100">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            <span className="text-3xl font-black text-orange-600">{stats?.streak ?? 0}</span>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-[#656E77] mt-1">
            連続学習日
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-10">
        <Button
          onClick={() => onStartReview(s.dueToday > 0 ? "due" : "all")}
          className="h-12 px-6 rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold"
        >
          復習を始める
        </Button>
        <Button
          onClick={onOpenExtract}
          variant="outline"
          className="h-12 px-6 rounded-2xl border-2 border-[#E5E7EB] font-bold text-[#656E77] hover:border-[#2A5CFF] hover:text-[#2A5CFF]"
        >
          <ClipboardPaste className="w-4 h-4 mr-2" />
          英文から集める
        </Button>
      </div>

      {/* 直近7日 */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB] mb-6">
        <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest mb-6">
          直近7日の追加
        </h3>
        <div className="flex items-end justify-between gap-2 h-28">
          {s.weekly.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-[10px] font-bold text-[#656E77]">{d.count || ""}</span>
              <div
                className="w-full rounded-t-md bg-[#2A5CFF] transition-all"
                style={{
                  height: `${Math.max(d.count ? 6 : 2, (d.count / maxDaily) * 80)}px`,
                  opacity: d.count ? 1 : 0.15,
                }}
              />
              <span className="text-[9px] font-bold text-[#656E77]">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* デッキ別 */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E7EB]">
        <div className="flex items-center gap-2 mb-6">
          <Layers className="w-4 h-4 text-[#656E77]" />
          <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">
            デッキ別の定着
          </h3>
        </div>

        {progress.length === 0 ? (
          <p className="text-xs text-[#656E77]">まだデッキがありません。</p>
        ) : (
          <div className="space-y-4">
            {progress.map((row) => (
              <button
                key={row.deck?.id ?? "unfiled"}
                onClick={() => onSelectDeck(row.deck?.id ?? null)}
                className="w-full text-left group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: row.deck?.color ?? "#D1D5DB" }}
                    />
                    <span className="text-xs font-bold text-[#1A1C1E] group-hover:text-[#2A5CFF] transition-colors">
                      {row.deck?.name ?? "未分類"}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-[#656E77]">
                    {Math.round(row.retained * 100)}% · {row.total} 語
                  </span>
                </div>
                <div className="h-1.5 bg-[#F1F3F5] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${row.retained * 100}%`,
                      backgroundColor: row.deck?.color ?? "#9CA3AF",
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {s.overdue > 20 && (
        <div className="mt-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            期限超過が {s.overdue} 語たまっています。一度に全部やろうとせず、
            「期限超過」から少しずつ片付けるのがおすすめです。
          </p>
        </div>
      )}
    </motion.div>
  );
};
