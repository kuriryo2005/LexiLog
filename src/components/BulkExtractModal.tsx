/**
 * 英文ペーストから未知語を一括抽出するモーダル（実装仕様書 F5）。
 *
 * 保存は「単語 + 短い意味」だけの軽量ドキュメントで即座に行い、詳細は
 * useEnrichQueue がバックグラウンドで埋める。1語ずつフル生成すると
 * 30語で数分待たされて実用にならないため。
 */

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, X, ClipboardPaste, Check } from "lucide-react";
import { writeBatch, doc, collection } from "firebase/firestore";
import { db } from "../firebase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { DictionaryMode, Deck, ExtractedCandidate, SavedWord } from "../types";
import { extractCandidates } from "../services/geminiService";
import { dedupeTags } from "../lib/filter";
import { toWordLower } from "../lib/normalize";

const MAX_TEXT = 8000;
const MAX_SAVE = 50;

interface Props {
  open: boolean;
  onClose: () => void;
  uid: string;
  words: SavedWord[];
  decks: Deck[];
  mode: DictionaryMode;
}

const LEVEL_STYLE: Record<string, string> = {
  B2: "bg-gray-100 text-gray-600",
  C1: "bg-blue-100 text-blue-700",
  C2: "bg-purple-100 text-purple-700",
  technical: "bg-orange-100 text-orange-700",
};

export const BulkExtractModal: React.FC<Props> = ({ open, onClose, uid, words, decks, mode }) => {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<ExtractedCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deckId, setDeckId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  const knownSet = useMemo(
    () => new Set(words.map((w) => w.wordLower ?? toWordLower(w.word))),
    [words]
  );

  const reset = () => {
    setText("");
    setTitle("");
    setCandidates(null);
    setSelected(new Set());
    setTagInput("");
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleExtract = async () => {
    const body = text.trim();
    if (!body) {
      toast.error("英文を貼り付けてください。");
      return;
    }

    setBusy(true);
    try {
      const known = [...knownSet].slice(0, 2000);
      const result = await extractCandidates(body.slice(0, MAX_TEXT), known);
      const fresh = result.filter((c) => !knownSet.has(toWordLower(c.word)));

      setCandidates(result);
      // 既定の選択は C1 以上と technical、かつ未保存のもの
      setSelected(
        new Set(fresh.filter((c) => c.level !== "B2").map((c) => toWordLower(c.word)))
      );

      if (result.length === 0) toast.info("抽出できる単語がありませんでした。");
      else toast.success(`${result.length} 語の候補が見つかりました（未保存 ${fresh.length} 語）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "抽出に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (word: string) => {
    const key = toWordLower(word);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!candidates) return;
    const picked = candidates.filter(
      (c) => selected.has(toWordLower(c.word)) && !knownSet.has(toWordLower(c.word))
    );

    if (picked.length === 0) {
      toast.error("保存する単語を選んでください。");
      return;
    }
    if (picked.length > MAX_SAVE) {
      toast.error(`一度に保存できるのは ${MAX_SAVE} 語までです。`);
      return;
    }

    setBusy(true);
    try {
      const tags = dedupeTags(tagInput.split(",").map((t) => t.trim()).filter(Boolean));
      const now = Date.now();
      const excerpt = text.trim().slice(0, 200);
      const batch = writeBatch(db);

      for (const c of picked) {
        // 空文字にできるのは grammar 以下だけ。meaning が空だと
        // セキュリティルールの isValidWord を通らない。
        batch.set(doc(collection(db, "words")), {
          word: c.word,
          wordLower: toWordLower(c.word),
          meaning: c.meaningShort,
          grammar: "",
          category: "",
          etymology: "",
          nuance: "",
          specializedContexts: [],
          examples: [],
          collocations: [],
          synonyms: [],
          antonyms: [],
          etymologyNodes: [],
          importanceScore: 0.5,
          userId: uid,
          timestamp: now,
          mode,
          tags,
          deckId,
          schemaVersion: 2,
          enrichStatus: "pending",
          source: { title: title.trim().slice(0, 100), excerpt, importedAt: now },
          updatedAt: now,
        });
      }

      await batch.commit();
      toast.success(`${picked.length} 語を保存しました。詳細は順次生成されます。`);
      reset();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const selectableCount = candidates
    ? candidates.filter((c) => selected.has(toWordLower(c.word)) && !knownSet.has(toWordLower(c.word)))
        .length
    : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[88vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between p-6 border-b border-[#E5E7EB]">
              <div>
                <h2 className="text-lg font-black text-[#1A1C1E]">英文から単語を集める</h2>
                <p className="text-xs text-[#656E77] mt-0.5">
                  論文や記事を貼り付けると、学習価値のある語を抽出します
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={close} disabled={busy}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {!candidates ? (
                <>
                  <Input
                    placeholder="出典タイトル（任意）"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-11 rounded-xl border-2 border-[#E5E7EB]"
                  />
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
                    placeholder="ここに英文を貼り付けてください..."
                    className="w-full h-64 p-4 rounded-2xl border-2 border-[#E5E7EB] bg-[#F8F9FA] focus:bg-white focus:border-[#2A5CFF] outline-none text-sm leading-relaxed resize-none"
                  />
                  <div className="flex justify-between items-center text-[11px] text-[#656E77] font-bold">
                    <span>
                      {text.length} / {MAX_TEXT} 文字
                    </span>
                    <span>保存済みの {knownSet.size} 語は候補から除外されます</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 items-center pb-2">
                    <select
                      value={deckId ?? ""}
                      onChange={(e) => setDeckId(e.target.value || null)}
                      className="h-9 px-3 rounded-lg border-2 border-[#E5E7EB] text-xs font-bold bg-white"
                    >
                      <option value="">未分類</option>
                      {decks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      placeholder="タグ（カンマ区切り・任意）"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      className="h-9 flex-1 min-w-[160px] rounded-lg border-2 border-[#E5E7EB] text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    {candidates.map((c) => {
                      const key = toWordLower(c.word);
                      const saved = knownSet.has(key);
                      const checked = selected.has(key) && !saved;

                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={saved}
                          onClick={() => toggle(c.word)}
                          title={c.sentence}
                          className={`w-full text-left p-3 rounded-xl border transition-colors flex items-start gap-3 ${
                            saved
                              ? "opacity-40 border-transparent cursor-not-allowed"
                              : checked
                              ? "bg-[#E9F0FF] border-[#2A5CFF]/30"
                              : "bg-white border-[#E5E7EB] hover:bg-[#F1F3F5]"
                          }`}
                        >
                          <div
                            className={`w-5 h-5 mt-0.5 shrink-0 rounded-md border-2 flex items-center justify-center ${
                              checked ? "bg-[#2A5CFF] border-[#2A5CFF]" : "border-[#D1D5DB]"
                            }`}
                          >
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-[#1A1C1E]">{c.word}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider ${
                                  LEVEL_STYLE[c.level] ?? LEVEL_STYLE.C1
                                }`}
                              >
                                {c.level}
                              </span>
                              {saved && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-bold">
                                  保存済み
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#656E77] mt-0.5">{c.meaningShort}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="p-6 border-t border-[#E5E7EB] flex gap-3">
              {!candidates ? (
                <Button
                  onClick={handleExtract}
                  disabled={busy || !text.trim()}
                  className="flex-1 h-12 rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold"
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      抽出中...
                    </>
                  ) : (
                    <>
                      <ClipboardPaste className="w-4 h-4 mr-2" />
                      単語を抽出する
                    </>
                  )}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setCandidates(null)}
                    disabled={busy}
                    className="h-12 rounded-2xl border-2 border-[#E5E7EB] font-bold text-[#656E77] px-6"
                  >
                    戻る
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={busy || selectableCount === 0}
                    className="flex-1 h-12 rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      `${selectableCount} 件を保存`
                    )}
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
