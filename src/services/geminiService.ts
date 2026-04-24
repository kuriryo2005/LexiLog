import { GoogleGenAI, Type } from "@google/genai";
import { DictionaryMode, WordDetail, SavedWord } from "../types";
import { db, auth } from "../firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Local session cache with persistence
const CACHE_KEY = "lexilog_local_cache";
const localCache = new Map<string, WordDetail>(
  (() => {
    try {
      const saved = localStorage.getItem(CACHE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  })()
);

function saveLocalCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(localCache.entries())));
}

export function getCachedWord(word: string, mode: DictionaryMode): WordDetail | null {
  const normalizedWord = word.trim().toLowerCase();
  const cacheKey = `${normalizedWord}_${mode}`;
  return localCache.get(cacheKey) || null;
}

export async function lookupWord(word: string, mode: DictionaryMode = DictionaryMode.GENERAL): Promise<WordDetail> {
  const normalizedWord = word.trim().toLowerCase();
  const cacheKey = `${normalizedWord}_${mode}`;

  // 1. Instant Local Session Cache check
  if (localCache.has(cacheKey)) {
    return localCache.get(cacheKey)!;
  }

  // 2. High-Performance Parallel Lookup
  const cacheRef = doc(db, "dictionary_cache", cacheKey);
  
  const firestoreLookup = getDoc(cacheRef).then(snap => {
    if (snap.exists()) {
      const data = snap.data() as WordDetail;
      console.log(`[Cache] Global hit for: ${normalizedWord}`);
      localCache.set(cacheKey, data);
      return data;
    }
    throw new Error("Cache miss");
  });

  const generateAI = async (): Promise<WordDetail> => {
    console.log(`[AI] Generating result for: ${normalizedWord}`);
    const modeContext = mode === DictionaryMode.GENERAL 
      ? "general everyday usage" 
      : "academic and research contexts";

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview", 
        contents: `Look up the English word "${normalizedWord}" specifically for ${modeContext}.
        Prioritize meanings in ${modeContext}.
        Provide:
        - meaning: Japanese translation
        - grammar: part of speech
        - category: professional field (e.g. Mechanical Engineering, Finance, etc.)
        - etymology: origin in Japanese
        - nuance: semantic difference from synonyms in Japanese
        - specializedContexts: 3 fields and concise Japanese usage explanations
        - etymologyNodes: shared root node list with an 'importance' score (0.0 to 1.0) for each
        - examples: 3 English/Japanese pairs
        - synonyms/antonyms: 3 pairs with translations
        - collocations: 5 common English verb/noun pairings (e.g. 'imbibe knowledge')
        - importanceScore: 0.0 to 1.0 overall importance in English/IELTS/Engineering.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              meaning: { type: Type.STRING },
              grammar: { type: Type.STRING },
              category: { type: Type.STRING },
              etymology: { type: Type.STRING },
              nuance: { type: Type.STRING },
              importanceScore: { type: Type.NUMBER },
              collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
              specializedContexts: { 
                type: Type.ARRAY, 
                items: {
                  type: Type.OBJECT,
                  properties: {
                    field: { type: Type.STRING },
                    context: { type: Type.STRING }
                  },
                  required: ["field", "context"]
                }
              },
              examples: { type: Type.ARRAY, items: { type: Type.STRING } },
              synonyms: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    translation: { type: Type.STRING }
                  },
                  required: ["word", "translation"]
                }
              },
              antonyms: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    translation: { type: Type.STRING }
                  },
                  required: ["word", "translation"]
                }
              },
              etymologyNodes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    root: { type: Type.STRING },
                    relation: { type: Type.STRING },
                    importance: { type: Type.NUMBER }
                  },
                  required: ["word", "meaning", "root", "relation", "importance"]
                }
              }
            },
            required: [
              "word", "meaning", "grammar", "category", "etymology", 
              "nuance", "specializedContexts", "examples", "synonyms", 
              "antonyms", "etymologyNodes", "importanceScore", "collocations"
            ]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) throw new Error("AI returned empty result");
      const result = JSON.parse(resultText) as WordDetail;
      
      // Save to Cache persistently (Async)
      localCache.set(cacheKey, result);
      saveLocalCache();
      if (auth.currentUser) {
        setDoc(cacheRef, { ...result, cachedAt: serverTimestamp() }).catch(e => console.error("Cache write error:", e));
      }
      
      return result;
    } catch (error) {
      console.error("AI Lookup Error:", error);
      throw error;
    }
  };

  try {
    return await Promise.any([firestoreLookup, generateAI()]);
  } catch (error) {
    if (error instanceof AggregateError) {
      throw error.errors[0];
    }
    throw error;
  }
}

export async function planNextReview(savedWord: SavedWord): Promise<{ nextReviewAt: number; aiAnalysis: string }> {
  const historyStr = (savedWord.reviewHistory || []).map(h => 
    `Rating: ${h.rating} at ${new Date(h.timestamp).toISOString()}`
  ).join("\n");

  const synonymsStr = savedWord.synonyms.map(s => s.word).join(", ");

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the learning progress for the English word "${savedWord.word}" (Meaning: ${savedWord.meaning}).
    Review History:
    ${historyStr || "First time being reviewed."}

    Based on the retention patterns, linguistic similarity to other words (like ${synonymsStr}), and common pitfalls for this type of word, determine the optimal "Next Review Date".
    Also provide a short "AI Analysis" in Japanese explaining why this word might be difficult for the user (e.g., confusion with similar roots, structural complexity).

    Return JSON with:
    - nextReviewAt: number (Unix timestamp in milliseconds)
    - aiAnalysis: string (In Japanese)`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nextReviewAt: { type: Type.NUMBER },
          aiAnalysis: { type: Type.STRING }
        },
        required: ["nextReviewAt", "aiAnalysis"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("AI failed to plan review");
  return JSON.parse(text);
}

export async function getEtymologyStory(word: string, meaning: string, etymology: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `英語の単語「${word}」（意味: ${meaning}）について、その語源や歴史的な背景を、学習者がワクワクするような「30秒で読めるショートストーリー」として日本語で語ってください。
      背景情報: ${etymology}`,
    });
    return response.text || "語源のストーリーは現在準備中です。";
  } catch (error) {
    console.error("Story generation error:", error);
    return "ストーリーを生成できませんでした。";
  }
}

export async function* lookupWordStream(word: string, mode: DictionaryMode = DictionaryMode.GENERAL) {
  const normalizedWord = word.trim().toLowerCase();
  const modeContext = mode === DictionaryMode.GENERAL ? "日常" : "学術";

  const response = await ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: `Look up "${normalizedWord}" in ${modeContext} context. 
    First, provide a quick translation and nuance in Japanese.
    Then, suggest 3 similar English words (typo correction or synonyms).
    Finally, provide a very short encouraging tip for learning this word.
    Format your response clearly with headers.`,
  });

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
