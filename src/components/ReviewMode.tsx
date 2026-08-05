/**
 * 復習モードの画面（実装仕様書 F3 / F4）。
 *
 * カードの順序は useReviewSession が持つ ID キューで固定されており、
 * この画面は表示と入力だけを担当する。onSnapshot でリストが並び替わっても
 * 進行位置がずれないのはそのため。
 *
 * 表示はカード状の囲みを使わず、上下の罫線で領域を示す。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, RotateCw, Volume2, Repeat } from "lucide-react";
import { ReviewRating, SavedWord } from "../types";
import type { ReviewSessionApi } from "../hooks/useReviewSession";
import {
  formatPhonetic,
  isTtsAvailable,
  loadTtsSettings,
  onVoicesReady,
  saveTtsSettings,
  speak,
  stopSpeaking,
  type TtsSettings,
} from "../lib/tts";

interface Props {
  api: ReviewSessionApi;
  /** 評価を記録する。DB への書き込みは呼び出し側の責務。 */
  onGrade: (rating: ReviewRating) => void;
  onExit: () => void;
}

const RATING_BUTTONS: {
  rating: ReviewRating;
  label: string;
  key: string;
  color: string;
}[] = [
  { rating: ReviewRating.AGAIN, label: "忘れた", key: "1", color: "#DC2626" },
  { rating: ReviewRating.HARD, label: "難しい", key: "2", color: "#EA580C" },
  { rating: ReviewRating.GOOD, label: "覚えた", key: "3", color: "#059669" },
  { rating: ReviewRating.EASY, label: "余裕", key: "4", color: "#2A5CFF" },
];

/** 裏面の項目。見出しは小さく、本文との間は余白で取る。 */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="mb-7">
    <div className="text-[10px] font-bold text-[#8A9199] uppercase tracking-[0.12em] mb-2">
      {label}
    </div>
    {children}
  </div>
);

function SpeakButton({
  word,
  settings,
  size = "md",
}: {
  word: string;
  settings: TtsSettings;
  size?: "sm" | "md";
}) {
  const [available, setAvailable] = useState(isTtsAvailable);

  // getVoices() は初回に空を返すことがある。埋まったタイミングで再判定する。
  useEffect(() => onVoicesReady(() => setAvailable(isTtsAvailable())), []);

  if (!available) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        speak(word, settings);
      }}
      title="発音を再生 (S)"
      className={`${
        size === "sm" ? "w-7 h-7" : "w-9 h-9"
      } shrink-0 flex items-center justify-center text-[#8A9199] hover:text-[#2A5CFF] transition-colors`}
    >
      <Volume2 className={size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5"} />
    </button>
  );
}

export const ReviewMode: React.FC<Props> = ({ api, onGrade, onExit }) => {
  const { current, position, total, isFinished, session } = api;
  const [isFlipped, setIsFlipped] = useState(false);
  const [settings, setSettings] = useState<TtsSettings>(loadTtsSettings);

  const updateSettings = useCallback((patch: Partial<TtsSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveTtsSettings(next);
      return next;
    });
  }, []);

  // カードが変わったら必ず表面に戻す。
  // 旧実装は setTimeout でめくり状態を戻していたため、タイミング次第で
  // 次のカードの答えが一瞬見えることがあった。
  useEffect(() => {
    setIsFlipped(false);
  }, [current?.id]);

  // 画面を離れるときは発話を止める（裏で喋り続けるのを防ぐ）
  useEffect(() => stopSpeaking, []);

  const grade = useCallback(
    (rating: ReviewRating) => {
      stopSpeaking();
      onGrade(rating);
    },
    [onGrade]
  );

  const flip = useCallback(() => {
    setIsFlipped((prev) => {
      const next = !prev;
      if (next && settings.autoPlayOnFlip && current) {
        // auto:true は「ユーザーが一度も再生ボタンを押していない iOS では鳴らさない」の意味
        speak(current.word, { ...settings, auto: true });
      }
      return next;
    });
  }, [settings, current]);

  // キーボード操作（実装仕様書 F3）
  useEffect(() => {
    if (isFinished) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        flip();
      } else if (e.key === "ArrowRight") {
        api.next();
      } else if (e.key === "ArrowLeft") {
        api.prev();
      } else if (e.key === "Escape") {
        onExit();
      } else if (e.key.toLowerCase() === "s") {
        if (current) speak(current.word, settings);
      } else if (isFlipped && ["1", "2", "3", "4"].includes(e.key)) {
        grade(Number(e.key) as ReviewRating);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, current, flip, grade, isFlipped, isFinished, onExit, settings]);

  const summary = useMemo(() => {
    const results = session?.results ?? {};
    const counts = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const rating of Object.values(results)) {
      if (rating === ReviewRating.AGAIN) counts.again++;
      else if (rating === ReviewRating.HARD) counts.hard++;
      else if (rating === ReviewRating.GOOD) counts.good++;
      else if (rating === ReviewRating.EASY) counts.easy++;
    }
    const graded = counts.again + counts.hard + counts.good + counts.easy;
    const elapsedSec = session ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
    return { counts, graded, elapsedSec };
  }, [session, isFinished]);

  // --- セッション終了画面 ---
  if (isFinished) {
    const { counts, graded, elapsedSec } = summary;
    const minutes = Math.floor(elapsedSec / 60);
    const seconds = elapsedSec % 60;

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xl mx-auto flex flex-col h-full justify-center py-6"
      >
        <h2 className="text-3xl font-black text-[#1A1C1E] mb-2">復習を終えました</h2>
        <p className="text-sm text-[#8A9199] mb-12">
          {graded} 枚 · {minutes > 0 ? `${minutes}分` : ""}
          {seconds}秒
        </p>

        <div className="grid grid-cols-4 gap-6 pt-6 border-t border-[#EAECEF] mb-12">
          {[
            { label: "忘れた", value: counts.again, color: "#DC2626" },
            { label: "難しい", value: counts.hard, color: "#EA580C" },
            { label: "覚えた", value: counts.good, color: "#059669" },
            { label: "余裕", value: counts.easy, color: "#2A5CFF" },
          ].map((s) => (
            <div key={s.label}>
              <div
                className="text-3xl font-black tabular-nums"
                style={{ color: s.value > 0 ? s.color : "#C9CDD2" }}
              >
                {s.value}
              </div>
              <div className="text-[11px] font-bold text-[#8A9199] mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-8">
          {counts.again > 0 && (
            <button type="button" onClick={() => api.restartWithAgain()} className="btn-primary">
              <Repeat className="w-4 h-4" />
              忘れた {counts.again} 枚をもう一周
            </button>
          )}
          <button type="button" onClick={onExit} className="btn-quiet px-0">
            終了する
          </button>
        </div>
      </motion.div>
    );
  }

  if (!current) return null;

  const phonetic = formatPhonetic(current.phonetic);
  const firstExample = current.examplePairs?.[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="max-w-xl mx-auto flex flex-col h-full justify-center py-6"
    >
      <div className="w-full flex justify-between items-start gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-[#1A1C1E]">復習</h2>
          <p className="text-xs text-[#8A9199] mt-1 tabular-nums">
            {position} / {total}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => updateSettings({ autoPlayOnFlip: !settings.autoPlayOnFlip })}
            title="めくったときに自動で発音する"
            className={`text-[11px] font-bold transition-colors ${
              settings.autoPlayOnFlip
                ? "text-[#2A5CFF] border-b border-[#2A5CFF]"
                : "text-[#8A9199] hover:text-[#1A1C1E]"
            }`}
          >
            自動発音 {settings.autoPlayOnFlip ? "オン" : "オフ"}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="text-[11px] font-bold text-[#8A9199] hover:text-[#1A1C1E]"
          >
            終了
          </button>
        </div>
      </div>

      {/* 進捗 */}
      <div className="w-full h-0.5 bg-[#F1F3F5] mb-0">
        <div
          className="h-0.5 bg-[#1A1C1E] transition-all duration-300"
          style={{ width: `${total ? ((position - 1) / total) * 100 : 0}%` }}
        />
      </div>

      {/* カード。囲まず、上下の罫線で領域を示す */}
      <div
        className="relative w-full aspect-[4/5] md:aspect-[4/3] perspective-1000 cursor-pointer border-b border-[#EAECEF]"
        onClick={flip}
      >
        <motion.div
          className="w-full h-full relative preserve-3d transition-transform duration-500"
          animate={{ rotateY: isFlipped ? 180 : 0 }}
        >
          {/* 表面 */}
          <div className="absolute inset-0 backface-hidden bg-white flex flex-col items-center justify-center px-6 text-center">
            <div className="flex items-center gap-3">
              <h3 className="text-3xl md:text-5xl font-black tracking-tighter text-[#1A1C1E]">
                {current.word}
              </h3>
              <SpeakButton word={current.word} settings={settings} />
            </div>

            {phonetic && (
              <p className="mt-3 text-sm md:text-base text-[#656E77] tracking-wide">{phonetic}</p>
            )}

            <p className="mt-10 text-[11px] text-[#8A9199] flex items-center gap-2">
              <RotateCw className="w-3 h-3" />
              クリックまたは Space でめくる
            </p>
          </div>

          {/* 裏面 */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 bg-white flex flex-col pt-8 overflow-auto">
            <Field label="意味">
              <p className="text-2xl font-bold text-[#1A1C1E] leading-snug">{current.meaning}</p>
            </Field>

            {current.grammar && (
              <Field label="品詞">
                <p className="text-sm font-bold text-[#1A1C1E]">{current.grammar}</p>
              </Field>
            )}

            {current.nuance && (
              <Field label="使い分け">
                <p className="text-sm text-[#656E77] leading-loose">{current.nuance}</p>
              </Field>
            )}

            {current.specializedContexts.length > 0 && (
              <Field label="専門分野での意味">
                <dl className="space-y-2">
                  {current.specializedContexts.slice(0, 2).map((ctx, i) => (
                    <div key={i} className="text-xs leading-loose">
                      <dt className="inline font-bold text-[#1A1C1E]">{ctx.field}</dt>
                      <dd className="inline text-[#656E77]"> — {ctx.context}</dd>
                    </div>
                  ))}
                </dl>
              </Field>
            )}

            {firstExample && (
              <Field label="例文">
                <p className="text-sm text-[#1A1C1E] leading-loose pl-4 border-l-2 border-[#EAECEF]">
                  {firstExample.en}
                </p>
                {firstExample.ja && (
                  <p className="text-xs text-[#8A9199] mt-1 pl-4">{firstExample.ja}</p>
                )}
              </Field>
            )}

            <p className="mt-auto pt-4 pb-2 text-center text-[11px] text-[#8A9199]">
              1 / 2 / 3 / 4 で評価
            </p>
          </div>
        </motion.div>
      </div>

      {isFlipped ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-4 gap-4 md:gap-6 mt-8 w-full"
        >
          {RATING_BUTTONS.map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                grade(b.rating);
              }}
              className="flex flex-col items-start pb-2 border-b-2 transition-colors"
              style={{ borderColor: b.color, color: b.color }}
            >
              <span className="text-sm font-black">{b.label}</span>
              <span className="text-[10px] text-[#8A9199]">{b.key}</span>
            </button>
          ))}
        </motion.div>
      ) : (
        <div className="flex gap-8 mt-8 w-full">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              api.prev();
            }}
            disabled={position <= 1}
            className="flex items-center gap-1.5 text-xs font-bold text-[#8A9199] hover:text-[#1A1C1E] disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            前の単語
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              api.next();
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-[#8A9199] hover:text-[#1A1C1E] transition-colors"
          >
            次の単語
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {current.aiAnalysis && !isFlipped && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-8 pl-4 border-l-2 border-[#EAECEF] text-xs text-[#656E77] leading-loose"
        >
          {current.aiAnalysis}
        </motion.p>
      )}
    </motion.div>
  );
};
