/**
 * デッキの管理モーダル（実装仕様書 F7）。
 *
 * 削除しても所属単語は消さない。確認文にもその旨を明記する
 * （「デッキを消したら単語まで消えた」は取り返しがつかないため）。
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()}
          className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[85vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between p-6 border-b border-[#E5E7EB]">
              <div>
                <h2 className="text-lg font-black text-[#1A1C1E]">デッキ</h2>
                <p className="text-xs text-[#656E77] mt-0.5">
                  単語をしまう入れ物。1単語につき1つまで
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} disabled={busy}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-2">
              {api.decks.length === 0 && (
                <p className="text-xs text-[#656E77] text-center py-8">
                  まだデッキがありません。下から作成できます。
                </p>
              )}

              {api.decks.map((deck) => (
                <div key={deck.id} className="p-3 rounded-xl border border-[#E5E7EB] space-y-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: deck.color }}
                    />
                    <Input
                      defaultValue={deck.name}
                      disabled={busy}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== deck.name) run(() => api.rename(deck.id, value));
                      }}
                      className="h-8 flex-1 text-sm font-bold border-0 bg-transparent px-1 focus:bg-[#F1F3F5] rounded"
                    />
                    <span className="text-[10px] font-bold text-[#656E77] shrink-0">
                      {countIn(deck.id)} 語
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => setConfirming(deck)}
                      className="w-7 h-7 text-gray-300 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="flex gap-1.5 pl-5">
                    {DECK_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => api.recolor(deck.id, color))}
                        className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                          deck.color === color ? "ring-2 ring-offset-2 ring-[#1A1C1E]/20" : ""
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-6 border-t border-[#E5E7EB]">
              <div className="flex gap-2">
                <Input
                  placeholder="新しいデッキ名"
                  value={newName}
                  disabled={busy || api.decks.length >= MAX_DECKS}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      run(async () => {
                        await api.create(newName);
                        setNewName("");
                      });
                    }
                  }}
                  className="h-11 flex-1 rounded-xl border-2 border-[#E5E7EB]"
                />
                <Button
                  disabled={busy || !newName.trim() || api.decks.length >= MAX_DECKS}
                  onClick={() =>
                    run(async () => {
                      await api.create(newName);
                      setNewName("");
                    })
                  }
                  className="h-11 px-5 rounded-xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
              </div>
              {api.decks.length >= MAX_DECKS && (
                <p className="text-[10px] text-[#656E77] mt-2">
                  デッキは {MAX_DECKS} 個までです。
                </p>
              )}
            </div>
          </motion.div>

          {/* 削除の確認。単語が消えないことを明示する */}
          {confirming && (
            <div
              className="fixed inset-0 z-[210] bg-black/40 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl">
                <h3 className="font-black text-[#1A1C1E] mb-2">
                  「{confirming.name}」を削除しますか？
                </h3>
                <p className="text-xs text-[#656E77] leading-relaxed mb-6">
                  {countIn(confirming.id) > 0 ? (
                    <>
                      このデッキの <strong>{countIn(confirming.id)} 語は未分類に移動します</strong>。
                      単語は削除されません。
                    </>
                  ) : (
                    "このデッキには単語がありません。"
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setConfirming(null)}
                    className="flex-1 h-10 rounded-xl border-2 border-[#E5E7EB] font-bold text-[#656E77]"
                  >
                    やめる
                  </Button>
                  <Button
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
                    className="flex-1 h-10 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "削除する"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
