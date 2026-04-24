import React, { useMemo, useState, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { SavedWord, DictionaryMode } from "../types";
import { Card } from "./ui/card";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  Layers, 
  Wind, 
  Target, 
  Type, 
  History, 
  BookOpen,
  Maximize2,
  ChevronRight
} from "lucide-react";
import { getEtymologyStory } from "../services/geminiService";

interface Props {
  words: SavedWord[];
  onWordClick?: (word: SavedWord) => void;
}

type LayerType = "etymology" | "collocation" | "synonym";

export const KnowledgeMap: React.FC<Props> = ({ words, onWordClick }) => {
  const [layer, setLayer] = useState<LayerType>("etymology");
  const [hoverNode, setHoverNode] = useState<any>(null);
  const [selectedStory, setSelectedStory] = useState<{ word: string; story: string } | null>(null);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);

  // Compute graph data
  const graphData = useMemo(() => {
    const nodes: any[] = [];
    const links: any[] = [];
    const nodeMap = new Map<string, any>();

    // 1. Add learned words as primary nodes
    words.forEach(word => {
      if (!word.word) return;
      const timeSinceReview = word.nextReviewAt ? Math.max(0, Date.now() - word.nextReviewAt) : 0;
      const daysOverdue = timeSinceReview / (1000 * 60 * 60 * 24);
      
      // Node Weathering: Opacity decreases with overdue time
      const opacity = Math.max(0.3, 1 - (daysOverdue / 14));
      
      const isDue = word.nextReviewAt ? word.nextReviewAt <= Date.now() : true;
      
      const node = {
        id: word.id,
        word: word.word,
        meaning: word.meaning,
        category: word.category,
        importance: word.importanceScore || 0.5,
        isLearned: true,
        opacity,
        isOverdue: daysOverdue > 0,
        isDue,
        data: word
      };
      nodes.push(node);
      nodeMap.set(word.word.toLowerCase(), node);
    });

    // 2. Build linkages and Etymology Bridges (Silhouettes)
    words.forEach(word => {
      if (layer === "etymology") {
        (word.etymologyNodes || []).forEach(ref => {
          if (!ref.word) return;
          const targetLower = ref.word.toLowerCase();
          let targetNode = nodeMap.get(targetLower);

          // If target word is not learned yet, add it as a silhouette
          if (!targetNode) {
            targetNode = {
              id: `ghost-${targetLower}`,
              word: ref.word,
              meaning: ref.meaning,
              category: word.category,
              importance: ref.importance || 0.3,
              isLearned: false,
              opacity: 0.2, // Ghostly appearance
              isOverdue: false
            };
            nodes.push(targetNode);
            nodeMap.set(targetLower, targetNode);
          }

          links.push({
            source: word.id,
            target: targetNode.id,
            value: (ref.importance || 0.5) * 5, // Engineering: Link thickness
            label: ref.root,
            isGhost: !targetNode.isLearned
          });
        });
      } else if (layer === "synonym") {
        (word.synonyms || []).forEach(syn => {
          if (!syn.word) return;
          const targetLower = syn.word.toLowerCase();
          const targetNode = nodeMap.get(targetLower);
          if (targetNode) {
            links.push({
              source: word.id,
              target: targetNode.id,
              value: 2,
              label: "synonym"
            });
          }
        });
      } else if (layer === "collocation") {
        (word.collocations || []).forEach(col => {
           // We could find other words sharing similar collocations/contexts
           // For now, simplify collocation layer by clustering similar categoried words stronger
        });
      }
    });

    return { nodes, links };
  }, [words, layer]);

  const handleNodeClick = async (node: any) => {
    if (!node.isLearned) return; // Ignore ghost nodes or prompt to search?

    const word: SavedWord = node.data;
    setIsGeneratingStory(true);
    try {
      const story = await getEtymologyStory(word.word, word.meaning, word.etymology);
      setSelectedStory({ word: word.word, story });
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingStory(false);
    }
    
    if (onWordClick) onWordClick(word);
  };

  if (words.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white/40 rounded-3xl border border-dashed border-gray-200">
        <Target className="w-12 h-12 text-blue-300 mb-4" />
        <h3 className="text-xl font-black text-[#1A1C1E] mb-2">未完成のナレッジパズル</h3>
        <p className="text-sm text-[#656E77] max-w-sm">
          単語を検索して保存すると、工学的な重み付けと語源の繋がりを持つマップが生成されます。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header & Layer Selection */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h2 className="text-2xl font-black text-[#1A1C1E] flex items-center gap-2">
             <Layers className="w-6 h-6 text-blue-600" />
             Cortex Semantic Gravity
           </h2>
           <p className="text-sm font-medium text-gray-500">
             専門分野の「重力」と「風化」をシミュレートしたナレッジマップ
           </p>
        </div>

        <div className="flex p-1 bg-gray-100 rounded-2xl border border-gray-200">
           {(["etymology", "synonym"] as const).map(l => (
             <button
               key={l}
               onClick={() => setLayer(l)}
               className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                 layer === l 
                   ? "bg-white text-blue-600 shadow-sm border border-gray-200" 
                   : "text-gray-400 hover:text-gray-600"
               }`}
             >
               {l.toUpperCase()}
             </button>
           ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-[600px] rounded-[40px] overflow-hidden border border-gray-200 bg-white/50 backdrop-blur-sm shadow-xl">
        <ForceGraph2D
          graphData={graphData}
          nodeLabel={(node: any) => `${node.word}: ${node.meaning}`}
          nodeAutoColorBy="category"
          onNodeClick={handleNodeClick}
          onNodeHover={setHoverNode}
          linkColor={(link: any) => link.isGhost ? "#E5E7EB" : "#3B82F6"}
          linkWidth={(link: any) => link.value}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.005}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.word;
            // Semantic Gravity: Size depends on importance
            const radius = 5 + (node.importance * 15); 
            const fontSize = 12 / globalScale;
            
            // Draw Circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
            
            if (node.isLearned) {
               // Node Weathering: Adjust alpha
               ctx.fillStyle = `rgba(59, 130, 246, ${node.opacity})`;
               ctx.strokeStyle = node.isOverdue ? "rgba(239, 68, 68, 0.8)" : "rgba(37, 99, 235, 0.5)";
               if (node.isOverdue) {
                 // Drawing "cracks" if overdue (simplified)
                 ctx.setLineDash([2, 2]);
               }
            } else {
               // Ghost Silhouette
               ctx.fillStyle = "rgba(229, 231, 235, 0.3)";
               ctx.strokeStyle = "rgba(209, 213, 219, 0.5)";
               ctx.setLineDash([5, 5]);
            }
            
            // Target Glow for important words or Daily Targets
            if (node.isLearned && (node.importance > 0.8 || node.isDue)) {
               ctx.shadowBlur = node.isDue ? 15 : 10;
               ctx.shadowColor = node.isDue ? "#10B981" : "#3B82F6"; // Emerald for Daily Target
            }
            
            ctx.lineWidth = 1 / globalScale;
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]); // Reset dash
            ctx.shadowBlur = 0; // Reset shadow for text

            // Draw Text
            ctx.font = `${fontSize}px Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = node.isLearned ? "#1F2937" : "#9CA3AF";
            ctx.fillText(label, node.x, node.y + radius + fontSize + 2);
          }}
        />

        {/* Legend Overlay */}
        <div className="absolute top-6 left-6 flex flex-col gap-3 pointer-events-none">
           <div className="p-4 bg-white/80 backdrop-blur-md rounded-2xl border border-gray-100 shadow-lg max-w-[200px]">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Map Legend</h4>
              <div className="space-y-3">
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-[11px] font-bold text-gray-700">Learned Node</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-gray-200 border border-dashed border-gray-300" />
                    <span className="text-[11px] font-bold text-gray-400">Undiscovered (Bridge)</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full border-2 border-red-400 border-dashed" />
                    <span className="text-[11px] font-bold text-gray-600">Weathering (Need Review)</span>
                 </div>
              </div>
           </div>
        </div>

        {/* Story Modal */}
        <AnimatePresence>
          {selectedStory && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center p-8 bg-black/20 backdrop-blur-sm"
              onClick={() => setSelectedStory(null)}
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white p-8 rounded-[40px] shadow-2xl max-w-lg w-full relative"
                onClick={e => e.stopPropagation()}
              >
                <button 
                  onClick={() => setSelectedStory(null)}
                  className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ChevronRight className="w-6 h-6 text-gray-400" />
                </button>
                <div className="flex items-center gap-3 mb-6">
                   <div className="p-2 bg-blue-100 rounded-xl">
                      <Sparkles className="w-5 h-5 text-blue-600" />
                   </div>
                   <h3 className="text-xl font-black text-[#1A1C1E]">語源のショートストーリー: {selectedStory.word}</h3>
                </div>
                <div className="prose prose-sm text-gray-700 leading-relaxed font-medium">
                   {selectedStory.story}
                </div>
                <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                   <button 
                     onClick={() => setSelectedStory(null)}
                     className="px-6 py-2 bg-[#1A1C1E] text-white rounded-xl text-xs font-black"
                   >
                     CLOSE
                   </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {isGeneratingStory && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
             <div className="flex flex-col items-center gap-4">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full"
                />
                <span className="text-xs font-black text-blue-600 uppercase tracking-widest">Generating Story...</span>
             </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 bg-blue-50/50 rounded-2xl border border-blue-100">
         <div className="flex items-center gap-3">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <span className="text-[11px] font-bold text-blue-800">
               工学的ヒューリスティクス：重要度が高い単語ほど中央に配置され、強い重力を持ちます。
            </span>
         </div>
         <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
               <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
               <span className="text-[10px] font-black text-blue-600 uppercase">Live Simulation</span>
            </div>
         </div>
      </div>
    </div>
  );
};
