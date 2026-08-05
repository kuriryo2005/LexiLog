/**
 * 保存済みの単語に、単語帳の紙面用の項目（語義の番号分け・ターゲットフレーズ・
 * 派生語）を後から足す。
 *
 * 対象は schemaVersion が v3 未満のドキュメント。43件の既存データがこれにあたる。
 *
 * **既に入っている情報は上書きしない。**
 * meaning のような「これまで調べた結果」はそのまま残し、空欄だけを埋める。
 * ユーザーが手で直した訳を AI の生成結果で潰さないため。
 *
 * 自動では走らせない。1語につき1回 AI を呼ぶので、実行はボタン操作に限る。
 */

import { useCallback, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { DictionaryMode, SavedWord } from "../types";
import { lookupWord } from "../services/geminiService";
import { TARGET_SCHEMA_VERSION } from "../lib/normalize";

/** 同時に走らせる本数。増やすとレート制限に当たりやすくなる。 */
const CONCURRENCY = 2;

export interface BackfillProgress {
  /** まだ v3 になっていない件数 */
  pending: number;
  /** この実行で終わった件数 */
  done: number;
  /** この実行の対象総数 */
  total: number;
  running: boolean;
  failed: number;
}

export interface TargetBackfillApi extends BackfillProgress {
  start: () => void;
  cancel: () => void;
}

/**
 * 例文に和訳が付いていないか。
 *
 * 以前のスキーマは例文を "英文\n和訳" の1本の文字列で保存していたが、
 * モデルが英文しか返さないことがあり、和訳の無い例文が保存されている。
 * 英文だけが入っていても「例文がある」ことにはならないので、作り直しの対象にする。
 */
export function lacksExampleJa(word: SavedWord): boolean {
  const pairs = word.examplePairs ?? [];
  return pairs.length > 0 && !pairs.some((p) => (p.ja ?? "").trim());
}

/** 保存済みドキュメントに紙面用の項目が揃っているか。 */
export function needsBackfill(word: SavedWord): boolean {
  if (word.enrichStatus === "pending") return false;
  return (word.schemaVersion ?? 1) < TARGET_SCHEMA_VERSION || lacksExampleJa(word);
}

/** 空（未設定・空文字・空配列）かどうか。 */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function useTargetBackfill(words: SavedWord[]): TargetBackfillApi {
  const [state, setState] = useState<Omit<BackfillProgress, "pending">>({
    done: 0,
    total: 0,
    running: false,
    failed: 0,
  });

  const cancelledRef = useRef(false);
  const runningRef = useRef(false);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const pending = words.filter(needsBackfill).length;

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;

    const targets = wordsRef.current.filter(needsBackfill);
    if (targets.length === 0) return;

    runningRef.current = true;
    cancelledRef.current = false;
    setState({ done: 0, total: targets.length, running: true, failed: 0 });

    let cursor = 0;

    const worker = async () => {
      for (;;) {
        if (cancelledRef.current) return;
        const item = targets[cursor++];
        if (!item) return;

        try {
          const detail = await lookupWord(item.word, item.mode ?? DictionaryMode.GENERAL);

          // 紙面用の項目は新規なので必ず入れる
          const patch: Record<string, unknown> = {
            senses: detail.senses ?? [],
            targetPhrases: detail.targetPhrases ?? [],
            derivatives: detail.derivatives ?? [],
            examLevel: detail.examLevel ?? "",
            schemaVersion: TARGET_SCHEMA_VERSION,
            updatedAt: Date.now(),
          };

          // 和訳の無い例文は、英文だけが残っていても作り直す。
          // ここを「空のときだけ」にすると、和訳が欠けたまま直らない
          if (lacksExampleJa(item) && (detail.examples ?? []).length > 0) {
            patch.examples = detail.examples;
          }

          // それ以外は「今が空のときだけ」埋める。既存の内容は残す
          const fillable: [keyof typeof detail, unknown][] = [
            ["grammar", item.grammar],
            ["phonetic", item.phonetic],
            ["category", item.category],
            ["etymology", item.etymology],
            ["nuance", item.nuance],
            ["examples", item.examples],
            ["collocations", item.collocations],
            ["synonyms", item.synonyms],
            ["antonyms", item.antonyms],
            ["specializedContexts", item.specializedContexts],
            ["etymologyNodes", item.etymologyNodes],
          ];

          for (const [key, currentValue] of fillable) {
            const generated = detail[key];
            if (isEmpty(currentValue) && !isEmpty(generated)) {
              patch[key as string] = generated;
            }
          }

          await updateDoc(doc(db, "words", item.id), patch);
          if (!cancelledRef.current) setState((s) => ({ ...s, done: s.done + 1 }));
        } catch (e) {
          console.warn(`単語帳データの補完に失敗しました: ${item.word}`, e);
          if (!cancelledRef.current) {
            setState((s) => ({ ...s, done: s.done + 1, failed: s.failed + 1 }));
          }
        }
      }
    };

    Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => {
      runningRef.current = false;
      setState((s) => ({ ...s, running: false }));
    });
  }, []);

  return { ...state, pending, start, cancel };
}
