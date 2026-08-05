import React, { useMemo, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { SavedWord } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { X, Search, Loader2 } from "lucide-react";
import { getEtymologyStory } from "../services/geminiService";
import { buildGraph, GraphLayer, MapNode } from "../lib/graph";

interface Props {
  words: SavedWord[];
  onWordClick?: (word: SavedWord) => void;
  /** 未保存の関連語を押したとき。検索に回す */
  onSearchWord?: (word: string) => void;
  /** 生成した語源の解説を保存する。呼び出し側が Firestore に書き戻す */
  onStoryGenerated?: (wordId: string, story: string) => Promise<void> | void;
}

// ---- 色。アプリのデザイントークンに合わせる -------------------------
// primary  #2A5CFF = rgba(42,  92, 255, ...)  保存済み語ノード・類義線
// ink      #1A1C1E = rgba(26,  28,  30, ...)  語根輪郭・ラベル
// muted    #8A9199 = rgba(138,145, 153, ...)  ghost・対義線
// border   #EAECEF = rgba(234,236, 239, ...)  ghost 塗り
const APP = {
  primary: "42, 92, 255",   // #2A5CFF
  ink:     "26, 28, 30",    // #1A1C1E
  muted:   "138, 145, 153", // #8A9199
  border:  "234, 236, 239", // #EAECEF
} as const;

const LINK_COLORS: Record<string, string> = {
  root:    `rgba(${APP.ink}, 0.2)`,
  direct:  `rgba(${APP.ink}, 0.15)`,
  synonym: `rgba(${APP.primary}, 0.45)`,
  antonym: `rgba(${APP.muted}, 0.55)`,
};

const LAYER_TABS: { key: GraphLayer; label: string }[] = [
  { key: "etymology", label: "語源" },
  { key: "synonym",  label: "類義語" },
  { key: "antonym",  label: "対義語" },
];

const LAYER_DESC: Record<GraphLayer, (rootCount: number) => string> = {
  etymology: (n) => `同じ語根の単語が一つの房に集まります。語根 ${n} 種類`,
  synonym:   () => "意味が近い単語どうしを結びます。灰色は未保存の類義語",
  antonym:   () => "意味が反転する単語どうしを結びます。灰色は未保存の対義語",
};

export const KnowledgeMap: React.FC<Props> = ({
  words,
  onWordClick,
  onSearchWord,
  onStoryGenerated,
}) => {
  const [layer, setLayer]           = useState<GraphLayer>("etymology");
  const [selected, setSelected]     = useState<MapNode | null>(null);
  const [story, setStory]           = useState<string>("");
  const [isGenerating, setIsGen]    = useState(false);
  /**
   * 復習の遅れを地図に重ねるかどうか。
   *
   * 改善 6: 意味のつながりと復習の進捗は別の軸なので、デフォルトはオフにする。
   * オンにしたときだけノードが薄くなり、期限超過は破線の輪郭になる。
   */
  const [showOverdue, setShowOverdue] = useState(false);

  const graphData = useMemo(() => buildGraph(words, layer), [words, layer]);

  const rootCount = useMemo(
    () => graphData.nodes.filter((n) => n.kind === "root").length,
    [graphData]
  );

  const closePanel = useCallback(() => {
    setSelected(null);
    setStory("");
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    const n = node as MapNode;
    setSelected(n);
    setStory(n.kind === "word" ? n.data?.etymologyStory ?? "" : "");
  }, []);

  /**
   * 語源の解説を生成する。
   *
   * 以前はノードを押すたびに毎回 API を呼んでいた。結果を Firestore に書き戻して
   * 使い回す（etymologyStory フィールド）。2回目以降は即座に表示される。
   */
  const generateStory = useCallback(async () => {
    const word = selected?.data;
    if (!word || isGenerating) return;
    setIsGen(true);
    try {
      const text = await getEtymologyStory(word.word, word.meaning, word.etymology);
      setStory(text);
      await onStoryGenerated?.(word.id, text);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGen(false);
    }
  }, [selected, isGenerating, onStoryGenerated]);

  if (words.length === 0) {
    return (
      <div className="h-full flex flex-col justify-center max-w-xl mx-auto w-full">
        <h3 className="text-2xl font-black text-[#1A1C1E] mb-3">表示できる単語がありません</h3>
        <p className="text-sm text-[#656E77] leading-relaxed">
          単語を保存すると、語源や類義語のつながりを図として表示します。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-black text-[#1A1C1E]">単語のつながり</h2>
          <p className="text-sm text-[#8A9199] mt-1">
            {LAYER_DESC[layer](rootCount)}
          </p>
        </div>

        <div className="flex items-center gap-6">
          {/* 復習の遅れオーバーレイ */}
          <button
            onClick={() => setShowOverdue((v) => !v)}
            className={`text-xs font-bold pb-1 border-b-2 transition-colors ${
              showOverdue
                ? "text-[#1A1C1E] border-[#1A1C1E]"
                : "text-[#8A9199] border-transparent hover:text-[#1A1C1E]"
            }`}
          >
            復習の遅れ
          </button>

          <div className="w-px h-4 bg-[#EAECEF]" />

          {/* レイヤータブ */}
          {LAYER_TABS.map((l) => (
            <button
              key={l.key}
              onClick={() => { setLayer(l.key); closePanel(); }}
              className={`text-xs font-bold pb-1 border-b-2 transition-colors ${
                layer === l.key
                  ? "text-[#1A1C1E] border-[#1A1C1E]"
                  : "text-[#8A9199] border-transparent hover:text-[#1A1C1E]"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-[600px] overflow-hidden border-t border-b border-[#EAECEF]">
        <ForceGraph2D
          graphData={graphData as any}
          nodeLabel={(node: any) =>
            node.kind === "root" ? `語根 ${node.label}` : `${node.label}: ${node.meaning}`
          }
          onNodeClick={handleNodeClick}
          linkColor={(link: any) => LINK_COLORS[link.kind] ?? "rgba(107,114,128,0.4)"}
          linkWidth={(link: any) => (link.kind === "root" ? 1.2 : 1)}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const n = node as MapNode & { x: number; y: number };
            const radius = 4 + n.importance * 12;
            const fontSize = 12 / globalScale;

            ctx.beginPath();
            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);

            if (n.kind === "word") {
              const opacity = showOverdue ? Math.max(0.3, 1 - n.daysOverdue / 14) : 1;
              ctx.fillStyle = `rgba(${APP.primary}, ${opacity})`;
              if (showOverdue && n.daysOverdue > 0) {
                ctx.strokeStyle = "rgba(220, 38, 38, 0.8)";
                ctx.setLineDash([2, 2]);
              } else {
                ctx.strokeStyle = `rgba(${APP.primary}, 0.4)`;
              }
            } else if (n.kind === "root") {
              ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
              ctx.strokeStyle = `rgba(${APP.ink}, 0.65)`;
            } else {
              // ghost
              ctx.fillStyle = `rgba(${APP.border}, 0.5)`;
              ctx.strokeStyle = `rgba(${APP.muted}, 0.55)`;
              ctx.setLineDash([4, 4]);
            }

            ctx.lineWidth = (n.kind === "root" ? 1.5 : 1) / globalScale;
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);

            // ラベル: Inter ではなくアプリ既定の sans-serif を使う
            const sans = "'Helvetica Neue', Arial, sans-serif";
            ctx.font = `${n.kind === "root" ? "italic " : ""}${fontSize}px ${sans}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle =
              n.kind === "ghost" ? `rgba(${APP.muted}, 1)` : `rgba(${APP.ink}, 1)`;
            ctx.fillText(n.label, n.x, n.y + radius + fontSize + 2);
          }}
        />

        {/* 凡例 */}
        <div className="absolute top-5 left-5 flex flex-col gap-2.5 pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2A5CFF]" />
            <span className="text-[11px] font-bold text-[#656E77]">保存済み</span>
          </div>
          {layer === "etymology" && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full border border-[#1A1C1E]" />
              <span className="text-[11px] font-bold text-[#656E77]">語根</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full border border-dashed border-[#8A9199]" />
            <span className="text-[11px] font-bold text-[#8A9199]">未保存の関連語</span>
          </div>
          {showOverdue && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-red-600" />
              <span className="text-[11px] font-bold text-[#656E77]">復習の期限超過</span>
            </div>
          )}
        </div>

        {/* 選んだノードのパネル */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18 }}
              className="absolute top-0 right-0 h-full w-full max-w-sm bg-white border-l border-[#EAECEF] px-8 py-7 overflow-y-auto"
            >
              <button
                onClick={closePanel}
                className="absolute top-6 right-6 text-[#8A9199] hover:text-[#1A1C1E]"
                aria-label="閉じる"
              >
                <X className="w-4 h-4" />
              </button>

              {selected.kind === "root" ? (
                <>
                  <p className="section-label mb-2">語根</p>
                  <h3 className="text-2xl font-black text-[#1A1C1E] italic mb-4">{selected.label}</h3>
                  <p className="text-sm text-[#656E77] leading-loose">
                    {selected.meaning || "この語根を共有する単語がまとまっています。"}
                  </p>
                  <p className="text-xs font-bold text-[#8A9199] mt-6">保存済み {selected.degree} 語</p>
                </>
              ) : selected.kind === "ghost" ? (
                <>
                  <p className="section-label mb-2">未保存の関連語</p>
                  <h3 className="text-2xl font-black text-[#1A1C1E] mb-4">{selected.label}</h3>
                  {selected.meaning && (
                    <p className="text-sm text-[#656E77] leading-loose">{selected.meaning}</p>
                  )}
                  <p className="text-xs font-bold text-[#8A9199] mt-6">
                    つながる保存済みの語 {selected.degree} 語
                  </p>
                  <div className="mt-8 pt-6 border-t border-[#EAECEF]">
                    <button
                      onClick={() => { onSearchWord?.(selected.label); closePanel(); }}
                      className="btn-quiet px-0 text-sm"
                    >
                      <Search className="w-4 h-4" />
                      この単語を調べる
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="section-label mb-2">{selected.data?.grammar || "保存済み"}</p>
                  <h3 className="text-2xl font-black text-[#1A1C1E] mb-1">{selected.label}</h3>
                  <p className="text-sm text-[#1A1C1E] leading-relaxed mb-6">{selected.meaning}</p>

                  {selected.data?.etymology && (
                    <div className="mb-6">
                      <p className="section-label mb-2">語源</p>
                      <p className="text-sm text-[#656E77] leading-loose">{selected.data.etymology}</p>
                    </div>
                  )}

                  {selected.data?.nuance && (
                    <div className="mb-6">
                      <p className="section-label mb-2">ニュアンス</p>
                      <p className="text-sm text-[#656E77] leading-loose">{selected.data.nuance}</p>
                    </div>
                  )}

                  {story ? (
                    <div className="mb-6">
                      <p className="section-label mb-2">語源の解説</p>
                      <p className="text-sm text-[#656E77] leading-loose">{story}</p>
                    </div>
                  ) : (
                    <button
                      onClick={generateStory}
                      disabled={isGenerating}
                      className="btn-quiet px-0 text-sm mb-6"
                    >
                      {isGenerating && <Loader2 className="w-4 h-4 animate-spin" />}
                      {isGenerating ? "生成しています" : "語源の解説を生成"}
                    </button>
                  )}

                  <div className="pt-6 border-t border-[#EAECEF]">
                    <button
                      onClick={() => selected.data && onWordClick?.(selected.data)}
                      className="btn-quiet px-0 text-sm"
                    >
                      詳細を開く
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
