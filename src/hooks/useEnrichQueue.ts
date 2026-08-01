/**
 * 一括取り込みした単語の詳細をバックグラウンドで埋める（実装仕様書 F5 ステップ7）。
 *
 * 取り込み時は「単語 + 短い意味」だけの軽量ドキュメントを作って即座に一覧へ出す。
 * 1語ずつフル生成すると N × 数秒かかって待たされるため、詳細は後追いにしている。
 *
 * ページを閉じても、次に開いたときに enrichStatus === 'pending' の単語を
 * 見つけて続きから処理する。
 */

import { useEffect, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { DictionaryMode, SavedWord } from "../types";
import { lookupWord } from "../services/geminiService";

/** 同時に走らせる本数。増やすとレート制限に当たりやすくなる。 */
const CONCURRENCY = 2;
/** 1回の起動で処理する上限。開いた瞬間に大量の生成が走るのを防ぐ。 */
const MAX_PER_RUN = 20;

export interface EnrichProgress {
  /** 残っている pending の件数 */
  remaining: number;
  /** この起動で処理し終えた件数 */
  completed: number;
  running: boolean;
}

export function useEnrichQueue(words: SavedWord[], enabled: boolean): EnrichProgress {
  const [progress, setProgress] = useState<EnrichProgress>({
    remaining: 0,
    completed: 0,
    running: false,
  });

  // 二重に走らせないための管理。id 単位で在庫を持つ。
  const inFlight = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const pendingCount = words.filter((w) => w.enrichStatus === "pending").length;

  useEffect(() => {
    setProgress((p) => ({ ...p, remaining: pendingCount }));
  }, [pendingCount]);

  useEffect(() => {
    if (!enabled || pendingCount === 0 || runningRef.current) return;

    runningRef.current = true;
    let cancelled = false;
    setProgress((p) => ({ ...p, running: true }));

    const run = async () => {
      const targets = wordsRef.current
        .filter((w) => w.enrichStatus === "pending" && !inFlight.current.has(w.id))
        .slice(0, MAX_PER_RUN);

      for (const w of targets) inFlight.current.add(w.id);

      let cursor = 0;
      const worker = async () => {
        for (;;) {
          if (cancelled) return;
          const item = targets[cursor++];
          if (!item) return;

          try {
            const detail = await lookupWord(item.word, item.mode ?? DictionaryMode.GENERAL);
            await updateDoc(doc(db, "words", item.id), {
              meaning: detail.meaning || item.meaning,
              grammar: detail.grammar ?? "",
              category: detail.category ?? "",
              etymology: detail.etymology ?? "",
              nuance: detail.nuance ?? "",
              phonetic: detail.phonetic ?? "",
              examples: detail.examples ?? [],
              collocations: detail.collocations ?? [],
              synonyms: detail.synonyms ?? [],
              antonyms: detail.antonyms ?? [],
              specializedContexts: detail.specializedContexts ?? [],
              etymologyNodes: detail.etymologyNodes ?? [],
              importanceScore: detail.importanceScore ?? 0.5,
              enrichStatus: "done",
              updatedAt: Date.now(),
            });
          } catch (e) {
            console.warn(`詳細の生成に失敗しました: ${item.word}`, e);
            // 失敗しても単語自体は残す。error にしておけば後から再試行できる。
            await updateDoc(doc(db, "words", item.id), {
              enrichStatus: "error",
              updatedAt: Date.now(),
            }).catch(() => {});
          } finally {
            inFlight.current.delete(item.id);
            if (!cancelled) setProgress((p) => ({ ...p, completed: p.completed + 1 }));
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    };

    run().finally(() => {
      runningRef.current = false;
      if (!cancelled) setProgress((p) => ({ ...p, running: false }));
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, pendingCount]);

  return progress;
}
