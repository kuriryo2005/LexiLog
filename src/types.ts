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

/**
 * 番号付きの語義（①②…）。
 * 訳は市販の受験単語帳の書き方に合わせる（他動詞は「を」「に」を頭に付け、
 * 目的語の種類は「(人)」「(物)」で示す）。
 */
export interface Sense {
  ja: string;
  /** その語義での品詞。全体の grammar と異なる場合だけ入る */
  pos?: string;
}

/**
 * ターゲットフレーズ。文法の型と訳の組。
 * 例: { en: "help A with B", ja: "AのBを手伝う" }
 */
export interface TargetPhrase {
  /** A / B / do / doing / ~ などのプレースホルダを含む型 */
  en: string;
  /** 訳。「」は含めない（表示側で付ける） */
  ja: string;
}

/** 派生語（名詞形・形容詞形など）。 */
export interface Derivative {
  word: string;
  /** 名 / 形 / 副 などの1文字記号 */
  pos: string;
  meaning: string;
}

/** 入試での頻出度。市販単語帳の Part 分けに相当する。 */
export type ExamLevel = "基礎" | "標準" | "難関";

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

  // --- v3 追加（単語帳の紙面用）。すべて optional ---
  /** 番号付きの語義。無い場合は meaning から生成する */
  senses?: Sense[];
  /** ターゲットフレーズ。無い場合は collocations から生成する */
  targetPhrases?: TargetPhrase[];
  derivatives?: Derivative[];
  examLevel?: ExamLevel;
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
  /**
   * つながり図で生成した語源の解説。
   * 生成のたびに課金されるので、一度作ったら書き戻して使い回す。
   */
  etymologyStory?: string;

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

  /** F5 の一括取り込み。詳細をまだ生成していない語は 'pending'。 */
  enrichStatus?: EnrichStatus;
  source?: WordSource;
}

export type EnrichStatus = "pending" | "done" | "error";

export interface WordSource {
  title?: string;
  excerpt?: string;
  importedAt: number;
}

/** 単語をしまう排他的な入れ物。1単語1デッキ（横断ラベルは tags で表現する）。 */
export interface Deck {
  id: string;
  userId: string;
  name: string;
  color: string;
  order: number;
  createdAt: number;
  updatedAt?: number;
}

export interface UserStats {
  userId: string;
  /** 'YYYY-MM-DD'（ローカルタイム基準） */
  lastStudiedOn?: string;
  streak?: number;
  longestStreak?: number;
  updatedAt?: number;
}

/** 一覧・復習・マップに共通で効く絞り込み。localStorage に保存する。 */
export interface WordFilter {
  /** null = 未分類のみ / undefined = すべて */
  deckId?: string | null;
  /** 複数指定は AND */
  tags: string[];
}

/** F5 で抽出した候補（保存前の状態） */
export interface ExtractedCandidate {
  word: string;
  meaningShort: string;
  level: "B2" | "C1" | "C2" | "technical";
  sentence: string;
}
