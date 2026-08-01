/**
 * デッキの購読と CRUD（実装仕様書 F7）。
 *
 * 重要: デッキを削除しても所属する単語は削除しない。先に単語の deckId を
 * null に戻してからデッキ本体を消す。逆順にすると、途中で失敗したときに
 * 存在しないデッキを指したままの単語が残る。
 */

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { Deck, SavedWord } from "../types";

export const MAX_DECKS = 20;

export const DECK_COLORS = [
  "#2A5CFF",
  "#7C3AED",
  "#059669",
  "#EA580C",
  "#DC2626",
  "#0891B2",
];

/**
 * デッキIDを作る。セキュリティルールの isValidId（ASCII のみ）を通す必要があるため、
 * 日本語のデッキ名はそのまま使えない。uid + 乱数で組み立てる。
 */
export function makeDeckId(uid: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${uid.slice(0, 20)}_${Date.now().toString(36)}_${rand}`;
}

export interface DecksApi {
  decks: Deck[];
  create: (name: string) => Promise<void>;
  rename: (deckId: string, name: string) => Promise<void>;
  recolor: (deckId: string, color: string) => Promise<void>;
  /** 所属単語を未分類に戻してからデッキを消す */
  remove: (deckId: string, words: SavedWord[]) => Promise<number>;
  assign: (wordIds: string[], deckId: string | null) => Promise<void>;
}

export function useDecks(uid: string | null): DecksApi {
  const [decks, setDecks] = useState<Deck[]>([]);

  useEffect(() => {
    if (!uid) {
      setDecks([]);
      return;
    }

    let unsubscribe: () => void = () => {};
    let cancelled = false;

    // words と同じ理由で、複合インデックスが無い環境ではフォールバックする
    const subscribe = (ordered: boolean) => {
      const q = ordered
        ? query(collection(db, "decks"), where("userId", "==", uid), orderBy("order", "asc"))
        : query(collection(db, "decks"), where("userId", "==", uid));

      unsubscribe = onSnapshot(
        q,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Deck, "id">) }));
          rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
          setDecks(rows);
        },
        (error) => {
          if (ordered && (error as { code?: string }).code === "failed-precondition") {
            unsubscribe();
            if (!cancelled) subscribe(false);
            return;
          }
          console.error("デッキの購読に失敗しました:", error);
        }
      );
    };

    subscribe(true);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [uid]);

  const create = useCallback(
    async (name: string) => {
      if (!uid) return;
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) throw new Error("デッキ名を入力してください。");
      if (decks.length >= MAX_DECKS) throw new Error(`デッキは ${MAX_DECKS} 個までです。`);

      const id = makeDeckId(uid);
      const now = Date.now();
      await setDoc(doc(db, "decks", id), {
        userId: uid,
        name: trimmed,
        color: DECK_COLORS[decks.length % DECK_COLORS.length],
        order: decks.length,
        createdAt: now,
        updatedAt: now,
      });
    },
    [uid, decks.length]
  );

  const rename = useCallback(async (deckId: string, name: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) throw new Error("デッキ名を入力してください。");
    await updateDoc(doc(db, "decks", deckId), { name: trimmed, updatedAt: Date.now() });
  }, []);

  const recolor = useCallback(async (deckId: string, color: string) => {
    await updateDoc(doc(db, "decks", deckId), { color, updatedAt: Date.now() });
  }, []);

  const assign = useCallback(async (wordIds: string[], deckId: string | null) => {
    const now = Date.now();
    // writeBatch は1回500件まで
    for (let i = 0; i < wordIds.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of wordIds.slice(i, i + 400)) {
        batch.update(doc(db, "words", id), { deckId, updatedAt: now });
      }
      await batch.commit();
    }
  }, []);

  const remove = useCallback(
    async (deckId: string, words: SavedWord[]) => {
      const affected = words.filter((w) => w.deckId === deckId).map((w) => w.id);
      // 先に単語を未分類へ戻す。順序を逆にすると、途中で失敗したときに
      // 存在しないデッキを指す単語が残ってしまう。
      await assign(affected, null);
      await deleteDoc(doc(db, "decks", deckId));
      return affected.length;
    },
    [assign]
  );

  return { decks, create, rename, recolor, remove, assign };
}
