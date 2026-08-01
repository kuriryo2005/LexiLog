export enum DictionaryMode {
  GENERAL = "一般",
  ACADEMIC = "学術（Academic）",
}

export interface ExamplePair {
  en: string;
  ja: string;
}

export interface WordRelation {
  word: string;
  translation: string;
}

export interface EtymologyNode {
  word: string;
  meaning: string;
  root: string; // The specific shared root/prefix (e.g. 'spect')
  relation: string; // e.g. "shares same root 'spect' (to look)"
  importance: number; // 0.0 to 1.0 (Engineering/IELTS relevance)
  isLearned?: boolean;
}

export interface SpecializedPerspective {
  field: string;
  context: string;
}

export interface WordDetail {
  word: string;
  meaning: string;
  grammar: string;
  etymology: string;
  nuance: string;
  specializedContexts: SpecializedPerspective[]; // Array of perspectives from different fields
  examples: string[];
  synonyms: WordRelation[];
  antonyms: WordRelation[];
  etymologyNodes: EtymologyNode[];
  category: string; // Engineering field or general category
  /** IPA。スラッシュは含めない。既存の保存済み単語には無い（F4 で遅延補完する）。 */
  phonetic?: string;
  collocations?: string[];
  importanceScore?: number; // 0.0 to 1.0
}

export enum ReviewRating {
  AGAIN = 1,
  HARD = 2,
  GOOD = 3,
  EASY = 4,
}

export interface ReviewSession {
  rating: ReviewRating;
  timestamp: number;
}

export interface SavedWord extends WordDetail {
  id: string;
  timestamp: number;
  mode?: DictionaryMode;
  reviewHistory?: ReviewSession[];
  nextReviewAt?: number;
  aiAnalysis?: string; // AI's comment on why this word is hard for the user

  // --- v2 追加（すべて optional）。既存ドキュメントには存在しない ---
  schemaVersion?: number;
  wordLower?: string;
  updatedAt?: number;
  tags?: string[];
  deckId?: string | null;
  /** IPA。スラッシュは含めない 例: "ˈtɜːbjələns" */
  phonetic?: string;
  /** 読み取り時に normalizeWord() が examples から生成する。Firestore には保存しない。 */
  examplePairs?: ExamplePair[];
}
