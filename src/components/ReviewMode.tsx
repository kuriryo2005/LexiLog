/**
 * 復習モードの画面（実装仕様書 F3 / F4）。
 *
 * カードの順序は useReviewSession が持つ ID キューで固定されており、
 * この画面は表示と入力だけを担当する。onSnapshot でリストが並び替わっても
 * 進行位置がずれないのはそのため。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Volume2,
  Check,
  Repeat,
} from "lucide-react";
import { ReviewRating, SavedWord } from "../types";
import { Button } from "./ui/button";
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
  sub: string;
  key: string;
  className: string;
}[] = [
  { rating: ReviewRating.AGAIN, label: "AGAIN", sub: "忘れた", key: "1", className: "bg-red-50 text-red-600 border-red-100 hover:bg-red-100" },
  { rating: ReviewRating.HARD, label: "HARD", sub: "難しい", key: "2", className: "bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100" },
  { rating: ReviewRating.GOOD, label: "GOOD", sub: "覚えた", key: "3", className: "bg-green-50 text-green-600 border-green-100 hover:bg-green-100" },
  { rating: ReviewRating.EASY, label: "EASY", sub: "余裕", key: "4", className: "bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100" },
];

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

  const px = size === "sm" ? "w-8 h-8" : "w-11 h-11";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        speak(word, settings);
      }}
      title="発音を再生 (S)"
      className={`${px} shrink-0 rounded-full bg-white border border-[#E5E7EB] text-[#2A5CFF] flex items-center justify-center hover:bg-[#E9F0FF] hover:border-[#2A5CFF]/30 transition-colors`}
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
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-xl mx-auto flex flex-col h-full items-center justify-center py-6 text-center"
      >
        <div className="w-16 h-16 rounded-3xl bg-[#E9F0FF] flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-[#2A5CFF]" />
        </div>

        <h2 className="text-3xl font-black text-[#1A1C1E] mb-2">セッション終了</h2>
        <p className="text-xs text-[#656E77] font-bold uppercase tracking-widest mb-10">
          {graded} cards · {minutes > 0 ? `${minutes}分` : ""}{seconds}秒
        </p>

        <div className="grid grid-cols-4 gap-3 w-full mb-10">
          {[
            { label: "AGAIN", value: counts.again, className: "bg-red-50 text-red-600 border-red-100" },
            { label: "HARD", value: counts.hard, className: "bg-orange-50 text-orange-600 border-orange-100" },
            { label: "GOOD", value: counts.good, className: "bg-green-50 text-green-600 border-green-100" },
            { label: "EASY", value: counts.easy, className: "bg-blue-50 text-blue-600 border-blue-100" },
          ].map((s) => (
            <div key={s.label} className={`rounded-2xl border p-4 ${s.className}`}>
              <div className="text-2xl font-black">{s.value}</div>
              <div className="text-[9px] font-black uppercase tracking-widest opacity-70">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="w-full space-y-3">
          {counts.again > 0 && (
            <Button
              onClick={() => api.restartWithAgain()}
              className="w-full h-12 rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold"
            >
              <Repeat className="w-4 h-4 mr-2" />
              AGAIN の {counts.again} 件をもう一周する
            </Button>
          )}
          <Button
            onClick={onExit}
            variant="outline"
            className="w-full h-12 rounded-2xl border-2 border-[#E5E7EB] font-bold text-[#656E77]"
          >
            終了する
          </Button>
        </div>
      </motion.div>
    );
  }

  if (!current) return null;

  const phonetic = formatPhonetic(current.phonetic);
  const firstExample = current.examplePairs?.[0];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-xl mx-auto flex flex-col h-full items-center justify-center py-6"
    >
      <div className="w-full flex justify-between items-center mb-8 md:mb-12">
        <div>
          <h2 className="text-2xl font-black text-[#1A1C1E]">復習モード</h2>
          <p className="text-xs text-[#656E77] font-bold uppercase tracking-widest mt-1">
            Card {position} of {total}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateSettings({ autoPlayOnFlip: !settings.autoPlayOnFlip })}
            title="めくったときに自動で発音する"
            className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full border transition-colors ${
              settings.autoPlayOnFlip
                ? "bg-[#E9F0FF] text-[#2A5CFF] border-[#2A5CFF]/20"
                : "bg-white text-[#656E77] border-[#E5E7EB]"
            }`}
          >
            自動発音 {settings.autoPlayOnFlip ? "ON" : "OFF"}
          </button>
          <Button
            variant="ghost"
            onClick={onExit}
            className="text-[#656E77] hover:text-[#1A1C1E] font-bold text-xs"
          >
            終了する
          </Button>
        </div>
      </div>

      {/* 進捗バー */}
      <div className="w-full h-1 bg-[#E5E7EB] rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-[#2A5CFF] transition-all duration-300"
          style={{ width: `${total ? ((position - 1) / total) * 100 : 0}%` }}
        />
      </div>

      <div
        className="relative w-full aspect-[4/5] md:aspect-[4/3] perspective-1000 group cursor-pointer"
        onClick={flip}
      >
        <motion.div
          className="w-full h-full relative preserve-3d transition-transform duration-500"
          animate={{ rotateY: isFlipped ? 180 : 0 }}
        >
          {/* 表面 */}
          <div className="absolute inset-0 backface-hidden bg-white rounded-3xl border border-[#E5E7EB] shadow-xl flex flex-col items-center justify-center p-8 md:p-12 text-center">
            <div className="flex flex-col items-center gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em]">Word</span>
              {current.mode && (
                <span className="text-[9px] px-2 py-0.5 bg-[#F1F3F5] text-[#656E77] rounded-full font-bold uppercase tracking-widest border border-[#E5E7EB]">
                  {current.mode}
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
              <h3 className="text-3xl md:text-5xl font-black tracking-tighter text-[#1A1C1E]">
                {current.word}
              </h3>
              <SpeakButton word={current.word} settings={settings} />
            </div>

            {phonetic && (
              <p className="mt-3 text-sm md:text-base text-[#656E77] font-medium tracking-wide">
                {phonetic}
              </p>
            )}

            <p className="mt-8 text-[10px] md:text-xs text-[#656E77] flex items-center gap-2">
              <RotateCw className="w-3 h-3" />
              クリック / Space でめくる
            </p>
          </div>

          {/* 裏面 */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 bg-[#E9F0FF] rounded-3xl border border-[#2A5CFF]/20 shadow-xl flex flex-col p-8 md:p-10 overflow-auto">
            <div className="mb-6">
              <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Meaning</span>
              <p className="text-2xl font-bold text-[#1A1C1E]">{current.meaning}</p>
            </div>

            {current.grammar && (
              <div className="mb-6">
                <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Grammar</span>
                <p className="text-sm font-bold text-[#1A1C1E] inline-block px-2 py-0.5 bg-white/50 rounded">
                  {current.grammar}
                </p>
              </div>
            )}

            {current.nuance && (
              <div className="mb-6">
                <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Nuance / 使い分け</span>
                <p className="text-sm font-medium text-[#1A1C1E] leading-relaxed bg-white/30 p-3 rounded-xl border border-white/40">
                  {current.nuance}
                </p>
              </div>
            )}

            {current.specializedContexts.length > 0 && (
              <div className="mb-6">
                <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Professional Perspectives</span>
                <div className="space-y-2">
                  {current.specializedContexts.slice(0, 2).map((ctx, i) => (
                    <div key={i} className="text-[10px] font-medium text-[#1A1C1E] bg-white/40 p-2 rounded-lg border border-white/50">
                      <span className="font-bold text-[#2A5CFF] mr-2">[{ctx.field}]</span>
                      {ctx.context}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {firstExample && (
              <div>
                <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Example</span>
                <p className="text-sm font-medium text-[#1A1C1E] leading-relaxed italic border-l-2 border-[#2A5CFF]/30 pl-3">
                  {firstExample.en}
                </p>
                {firstExample.ja && (
                  <p className="text-xs text-[#656E77] mt-1 pl-3">{firstExample.ja}</p>
                )}
              </div>
            )}

            <p className="mt-auto pt-4 text-center text-[10px] font-bold text-[#2A5CFF]/60 uppercase tracking-widest">
              1 / 2 / 3 / 4 で評価
            </p>
          </div>
        </motion.div>
      </div>

      {isFlipped && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mt-8 md:mt-12 w-full"
        >
          {RATING_BUTTONS.map((b) => (
            <Button
              key={b.label}
              onClick={(e) => {
                e.stopPropagation();
                grade(b.rating);
              }}
              className={`flex flex-col h-14 md:h-16 rounded-2xl border p-2 ${b.className}`}
            >
              <span className="text-xs font-black">{b.label}</span>
              <span className="text-[9px] md:text-[10px] opacity-70">
                {b.sub} · {b.key}
              </span>
            </Button>
          ))}
        </motion.div>
      )}

      {current.aiAnalysis && !isFlipped && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 p-4 bg-orange-50 rounded-2xl border border-orange-100 max-w-md"
        >
          <div className="flex items-center gap-2 mb-1">
            <BrainCircuit className="w-4 h-4 text-orange-500" />
            <span className="text-[10px] font-bold text-orange-600 uppercase tracking-widest">
              AI Retention Insight
            </span>
          </div>
          <p className="text-xs text-orange-800 leading-relaxed">{current.aiAnalysis}</p>
        </motion.div>
      )}

      <div className="flex gap-4 mt-8 md:mt-12 w-full">
        <Button
          onClick={(e) => { e.stopPropagation(); api.prev(); }}
          disabled={position <= 1}
          variant="outline"
          className="flex-1 h-12 md:h-14 rounded-2xl border-2 border-[#E5E7EB] hover:border-[#2A5CFF] hover:text-[#2A5CFF] group text-xs md:text-sm disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2 group-hover:-translate-x-1 transition-transform" />
          前の単語
        </Button>
        <Button
          onClick={(e) => { e.stopPropagation(); api.next(); }}
          variant="outline"
          className="flex-1 h-12 md:h-14 rounded-2xl border-2 border-[#E5E7EB] hover:border-[#2A5CFF] hover:text-[#2A5CFF] group text-xs md:text-sm"
        >
          次の単語
          <ChevronRight className="w-4 h-4 md:w-5 md:h-5 ml-1 md:ml-2 group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>
    </motion.div>
  );
};
