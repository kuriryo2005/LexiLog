/**
 * デッキの管理モーダル（実装仕様書 F7）。
 *
 * 削除しても所属単語は消さない。確認文にもその旨を明記する
 * （「デッキを消したら単語まで消えた」は取り返しがつかないため）。
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Trash2, Loader2 } from "lucide-react";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { Deck, SavedWord } from "../types";
import { DECK_COLORS, MAX_DECKS, type DecksApi } from "../hooks/useDecks";

interface Props {
  open: boolean;
  onClose: () => void;
  api: DecksApi;
  words: SavedWord[];
}

export const DeckManager: React.FC<Props> = ({ open, onClose, api, words }) => {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Deck | null>(null);

  const countIn = (deckId: string) => words.filter((w) => w.deckId === deckId).length;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const submitNew = () => {
    if (!newName.trim()) return;
    run(async () => {
      await api.create(newName);
      setNewName("");
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()}
          className="fixed inset-0 z-[200] bg-black/30 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[85vh] bg-white flex flex-col overflow-hidden"
          >
            <div className="flex items-start justify-between gap-4 px-8 pt-8 pb-6">
              <div>
                <h2 className="text-lg font-black text-[#1A1C1E]">デッキ</h2>
                <p className="text-xs text-[#8A9199] mt-1">1つの単語が入れるデッキは1つまでです。</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="w-8 h-8 shrink-0 flex items-center justify-center text-[#8A9199] hover:text-[#1A1C1E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-8">
              {api.decks.length === 0 && (
                <p className="text-xs text-[#8A9199] py-8 border-t border-[#EAECEF]">
                  デッキはまだありません。下の欄から作成できます。
                </p>
              )}

              {api.decks.map((deck) => (
                <div key={deck.id} className="py-4 border-t border-[#EAECEF]">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-2 h-2 shrink-0 rounded-full"
                      style={{ backgroundColor: deck.color }}
                    />
                    <Input
                      defaultValue={deck.name}
                      disabled={busy}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== deck.name) run(() => api.rename(deck.id, value));
                      }}
                      className="h-8 flex-1 text-sm font-bold bg-transparent border-0 rounded-none px-0 focus:ring-0 focus:outline-none"
                    />
                    <span className="text-[11px] text-[#8A9199] shrink-0 tabular-nums">
                      {countIn(deck.id)} 語
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming(deck)}
                      title="削除"
                      className="w-7 h-7 shrink-0 flex items-center justify-center text-[#C9CDD2] hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex gap-2 pl-5 mt-3">
                    {DECK_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => api.recolor(deck.id, color))}
                        title="色を変更"
                        className={`w-4 h-4 rounded-full transition-opacity ${
                          deck.color === color ? "opacity-100" : "opacity-30 hover:opacity-70"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-8 pt-6 pb-8 border-t border-[#EAECEF]">
              <div className="flex items-end gap-4">
                <Input
                  placeholder="新しいデッキ名"
                  value={newName}
                  disabled={busy || api.decks.length >= MAX_DECKS}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitNew()}
                  className="field h-10 flex-1 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !newName.trim() || api.decks.length >= MAX_DECKS}
                  onClick={submitNew}
                  className="btn-quiet h-10 px-0 text-sm"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "追加"}
                </button>
              </div>
              {api.decks.length >= MAX_DECKS && (
                <p className="text-[11px] text-[#8A9199] mt-3">
                  デッキは {MAX_DECKS} 個までです。
                </p>
              )}
            </div>
          </motion.div>

          {/* 削除の確認。単語が消えないことを明示する */}
          {confirming && (
            <div
              className="fixed inset-0 z-[210] bg-black/30 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full max-w-sm bg-white p-8">
                <h3 className="font-black text-[#1A1C1E] mb-3">
                  「{confirming.name}」を削除しますか？
                </h3>
                <p className="text-xs text-[#656E77] leading-loose mb-8">
                  {countIn(confirming.id) > 0 ? (
                    <>
                      このデッキの {countIn(confirming.id)} 語は未分類に移動します。
                      単語は削除されません。
                    </>
                  ) : (
                    "このデッキに単語はありません。"
                  )}
                </p>
                <div className="flex items-center gap-8">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const moved = await api.remove(confirming.id, words);
                        setConfirming(null);
                        toast.success(
                          moved > 0
                            ? `デッキを削除しました（${moved} 語を未分類へ移動）`
                            : "デッキを削除しました"
                        );
                      })
                    }
                    className="text-sm font-bold text-red-600 border-b border-red-600 disabled:opacity-30"
                  >
                    {busy ? "削除中" : "削除する"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="text-sm font-bold text-[#8A9199] hover:text-[#1A1C1E]"
                  >
                    やめる
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
