/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  Search, 
  BookOpen, 
  History, 
  Plus, 
  Trash2, 
  Loader2, 
  LogIn, 
  LogOut, 
  User,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  BrainCircuit,
  GraduationCap,
  Globe,
  Map as MapIcon,
  Hammer,
  Coins,
  Trophy,
  Activity,
  Gavel,
  Code,
  Sparkles,
  Download,
  Volume2,
  Layers,
  ClipboardPaste,
  Home,
  Tag as TagIcon,
  X
} from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { lookupWord, planNextReview, getCachedWord, fetchPhonetic } from "./services/geminiService";
import { coerceWordDetail, normalizeExamples, normalizeWord } from "./lib/normalize";
import { WordDetail, SavedWord, DictionaryMode, ReviewRating, ReviewSession, UserStats, WordFilter } from "./types";
import { useReviewSession } from "./hooks/useReviewSession";
import { useDecks } from "./hooks/useDecks";
import { useEnrichQueue } from "./hooks/useEnrichQueue";
import { applyFilter, collectTags, dedupeTags, isFilterActive, loadFilter, saveFilter } from "./lib/filter";
import { nextStreak } from "./lib/stats";
import {
  formatPhonetic,
  isTtsAvailable,
  loadTtsSettings,
  onVoicesReady,
  speak,
} from "./lib/tts";
import { EtymologyGraph } from "./components/EtymologyGraph";
import { KnowledgeMap } from "./components/KnowledgeMap";
import { DataTransferModal } from "./components/DataTransferModal";
import { ReviewMode } from "./components/ReviewMode";
import { Dashboard } from "./components/Dashboard";
import { DeckManager } from "./components/DeckManager";
import { BulkExtractModal } from "./components/BulkExtractModal";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { ScrollArea } from "./components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Separator } from "./components/ui/separator";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { auth, db } from "./firebase";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc,
  doc,
  orderBy,
  updateDoc,
  getDoc,
  setDoc
} from "firebase/firestore";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error("データベースエラーが発生しました。");
}

/** サイドバーの1ページ分の件数（実装仕様書 F2-c） */
const SIDEBAR_PAGE_SIZE = 100;

function WordSkeleton() {
  return (
    <div className="max-w-4xl mx-auto flex flex-col h-full animate-pulse">
      <div className="flex justify-between items-start mb-10">
        <div className="space-y-4">
          <Skeleton className="h-16 w-64 rounded-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-md" />
            <Skeleton className="h-6 w-24 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        <Skeleton className="md:col-span-2 h-32 rounded-2xl" />
        <Skeleton className="md:col-span-2 h-40 rounded-2xl" />
        <Skeleton className="md:col-span-2 h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WordDetail | null>(null);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"home" | "detail" | "flashcards" | "map">("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [dictionaryMode, setDictionaryMode] = useState<DictionaryMode>(DictionaryMode.GENERAL);
  /** サイドバーに描画する件数。全件を一度に DOM へ出さない（実装仕様書 F2-c）。 */
  const [visibleCount, setVisibleCount] = useState(SIDEBAR_PAGE_SIZE);
  const [suggestions, setSuggestions] = useState<SavedWord[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(isTtsAvailable);
  const [isDeckManagerOpen, setIsDeckManagerOpen] = useState(false);
  const [isExtractOpen, setIsExtractOpen] = useState(false);
  const [filter, setFilter] = useState<WordFilter>(loadFilter);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const decks = useDecks(user?.uid ?? null);

  // 絞り込みは一覧・復習・マップで同じ関数を通す。
  // 「一覧では絞れているのに復習には全部出る」というズレを防ぐため（F7）。
  const filteredWords = applyFilter(savedWords, filter);
  const allTags = collectTags(savedWords);

  const review = useReviewSession(savedWords);
  const enriching = useEnrichQueue(savedWords, !!user);

  useEffect(() => saveFilter(filter), [filter]);

  // 音声リストは非同期に読み込まれる。埋まったら再判定して再生ボタンを出す。
  useEffect(() => onVoicesReady(() => setTtsAvailable(isTtsAvailable())), []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  /**
   * 単語一覧の購読（実装仕様書 F2-b）。
   *
   * orderBy は以前「インデックス回避のため」外されていた。複合インデックス
   * （firestore.indexes.json）を作ったので復活させるが、インデックスの作成は
   * デプロイとは別作業なので、未作成の環境では failed-precondition で
   * 一覧が丸ごと出なくなってしまう。それを避けるため、失敗したら並べ替え無しで
   * 購読し直す。
   */
  useEffect(() => {
    if (!user) {
      setSavedWords([]);
      return;
    }

    let unsubscribe: () => void = () => {};
    let cancelled = false;

    const subscribe = (ordered: boolean) => {
      const q = ordered
        ? query(collection(db, "words"), where("userId", "==", user.uid), orderBy("timestamp", "desc"))
        : query(collection(db, "words"), where("userId", "==", user.uid));

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          // Firestore から読んだデータは例外なく normalizeWord を通す（鉄則 R3）。
          // v1 の既存データに tags や examplePairs を補うのはここだけの責務。
          const words = snapshot.docs.map((d) => normalizeWord(d.id, d.data()));
          // ordered の場合は既にサーバー側で並んでいるが、フォールバック時の
          // 順序を保証するために念のため揃える（43件程度では実測差が出ない）。
          words.sort((a, b) => b.timestamp - a.timestamp);
          setSavedWords(words);
        },
        (error) => {
          if (ordered && (error as { code?: string }).code === "failed-precondition") {
            console.warn("複合インデックスが未作成のため、並べ替え無しで購読し直します。", error);
            unsubscribe();
            if (!cancelled) subscribe(false);
            return;
          }
          handleFirestoreError(error, OperationType.LIST, "words");
        }
      );
    };

    subscribe(true);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  // 連続学習日数だけは単語一覧から計算できないので Firestore に置いてある（F6）。
  // 読み取りはログイン時の1回だけ。
  useEffect(() => {
    if (!user) {
      setUserStats(null);
      return;
    }
    let alive = true;
    getDoc(doc(db, "user_stats", user.uid))
      .then((snap) => {
        if (alive) setUserStats(snap.exists() ? (snap.data() as UserStats) : null);
      })
      .catch((e) => console.warn("学習統計の読み取りに失敗しました:", e));
    return () => {
      alive = false;
    };
  }, [user]);

  /** 今日まだ記録していなければ連続日数を進める。1日1回だけ書き込む。 */
  const touchStreak = () => {
    if (!user) return;
    const today = format(Date.now(), "yyyy-MM-dd");
    if (userStats?.lastStudiedOn === today) return;

    const updated = { ...nextStreak(userStats, new Date()), userId: user.uid };
    setUserStats(updated);
    setDoc(doc(db, "user_stats", user.uid), updated, { merge: true }).catch((e) =>
      console.warn("学習統計の保存に失敗しました:", e)
    );
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success("ログインしました");
    } catch (error) {
      console.error(error);
      toast.error("ログインに失敗しました");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.info("ログアウトしました");
    } catch (error) {
      console.error(error);
    }
  };

  /**
   * 評価を記録して次のカードへ（実装仕様書 F3）。
   *
   * 進行はキュー側が同期的に進めるので、旧実装のような setTimeout での
   * インデックス操作は無い。DB 書き込みは待たせない（UI を止めない）。
   */
  const handleReview = (rating: ReviewRating) => {
    const word = review.grade(rating);
    if (!word || !user) return;

    touchStreak();

    const session: ReviewSession = { rating, timestamp: Date.now() };
    const updatedHistory = [...(word.reviewHistory || []), session];

    (async () => {
      try {
        const { nextReviewAt, aiAnalysis } = await planNextReview({ ...word, reviewHistory: updatedHistory });
        await updateDoc(doc(db, "words", word.id), {
          reviewHistory: updatedHistory,
          nextReviewAt,
          aiAnalysis,
          updatedAt: Date.now(),
        });
      } catch (error) {
        console.error("Background review processing failed:", error);
      }
    })();
  };

const handleSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
    e?.preventDefault();
    const query = (overrideQuery || searchQuery).trim();
    if (!query) return;

    // NOTE: 以前ここに search_history への addDoc があったが、firestore.rules に
    // search_history のルールが無く、全書き込みが PERMISSION_DENIED で失敗していた
    // （エラーは .catch で握り潰されていた）。検索履歴が必要になった時点で
    // ルールとあわせて設計し直す。

    const cached = getCachedWord(query, dictionaryMode);
    if (cached) {
      setResult(cached);
      setActiveTab("detail");
      setSuggestions([]);
      setShowSuggestions(false);
      return; 
    }

    setLoading(true);
    setIsStreaming(true);
    setResult(null);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveTab("detail");

    try {
      const detail = await lookupWord(query, dictionaryMode, (partial) => {
        // 意味が届いた時点で描画を始める。全項目が揃うのを待たない。
        if (!partial?.meaning) return;
        setResult(coerceWordDetail(partial));
        setLoading(false);
      });
      setResult(detail);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "単語の検索に失敗しました。";
      toast.error(message);
      setResult(null);
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };
  // Debounced search suggestions
  useEffect(() => {
    if (searchQuery.length > 1) {
      const filtered = savedWords.filter(w => 
        w.word.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 5);
      setSuggestions(filtered);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchQuery, savedWords]);

  /**
   * 発音記号の遅延補完（実装仕様書 F4）。
   *
   * 既存の保存済み単語には phonetic が無い。鉄則 R2 により一括更新はしないので、
   * 詳細を開いたときに1件だけ取得して書き戻す。失敗しても UI には出さない
   * （無くても困らない付加情報なので、エラーで邪魔をしない）。
   */
  const phoneticAttempts = useRef<Set<string>>(new Set());

  useEffect(() => {
    const saved = result as SavedWord | null;
    if (!user || !saved?.id || saved.phonetic) return;
    if (phoneticAttempts.current.has(saved.id)) return;
    phoneticAttempts.current.add(saved.id);

    (async () => {
      try {
        const phonetic = await fetchPhonetic(saved.word);
        await updateDoc(doc(db, "words", saved.id), { phonetic, updatedAt: Date.now() });
        setResult((prev) =>
          prev && (prev as SavedWord).id === saved.id ? { ...prev, phonetic } : prev
        );
      } catch (e) {
        console.debug("発音記号の補完をスキップしました:", e);
      }
    })();
  }, [result, user]);

  // Re-search when mode changes if there's a query
  useEffect(() => {
    if (searchQuery.trim() && activeTab === 'detail') {
      handleSearch();
    }
  }, [dictionaryMode]);

  const saveWord = async () => {
    if (!result || !user) {
      if (!user) toast.error("ログインが必要です");
      return;
    }
    
    try {
      const now = Date.now();
      const wordData = {
        ...result,
        userId: user.uid,
        timestamp: now,
        mode: dictionaryMode,
        // v2 のフィールド。新規保存分だけ付ける（既存ドキュメントは書き換えない）
        schemaVersion: 2,
        wordLower: result.word.trim().toLowerCase(),
        updatedAt: now,
      };
      await addDoc(collection(db, "words"), wordData);
      toast.success(`${result.word} をリストに追加しました！`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "words");
    }
  };

  const deleteWord = async (id: string) => {
    try {
      await deleteDoc(doc(db, "words", id));
      toast.info("単語を削除しました。");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `words/${id}`);
    }
  };

  /**
   * 復習を開始する。
   *
   * デッキ/タグの絞り込みを先に効かせてから、ダッシュボードで押された
   * ブロックに応じて対象をさらに絞る。キューの構築自体は useReviewSession
   * が担当する（並び順とシャッフルはそちら）。
   */
  const startFlashcards = (scope: "due" | "overdue" | "fresh" | "all" = "all") => {
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const dayEnd = new Date(new Date().setHours(23, 59, 59, 999)).getTime();

    const pool = filteredWords.filter((w) => {
      if (scope === "all") return true;
      if (scope === "fresh") return w.nextReviewAt == null;
      if (scope === "overdue") return w.nextReviewAt != null && w.nextReviewAt < dayStart;
      // due: 期限超過と本日分、および未復習
      return w.nextReviewAt == null || w.nextReviewAt <= dayEnd;
    });

    if (pool.length === 0) {
      toast.error(
        isFilterActive(filter)
          ? "この絞り込みに該当する単語がありません。"
          : "復習できる単語がありません。"
      );
      return;
    }

    review.start(pool, { onlyDue: false });
    setActiveTab("flashcards");
    setIsSidebarOpen(false);
  };

  const exitFlashcards = () => {
    review.end();
    setActiveTab("home");
  };

  /** 単語詳細でタグを付け外しする（F7）。既存単語は初めてここで更新される。 */
  const updateTags = async (word: SavedWord, tags: string[]) => {
    try {
      await updateDoc(doc(db, "words", word.id), {
        tags: dedupeTags(tags),
        updatedAt: Date.now(),
      });
      setResult((prev) =>
        prev && (prev as SavedWord).id === word.id ? { ...prev, tags: dedupeTags(tags) } : prev
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `words/${word.id}`);
    }
  };

  /** 単語をデッキへ移す（F7）。 */
  const moveToDeck = async (word: SavedWord, deckId: string | null) => {
    try {
      await updateDoc(doc(db, "words", word.id), { deckId, updatedAt: Date.now() });
      setResult((prev) =>
        prev && (prev as SavedWord).id === word.id ? { ...prev, deckId } : prev
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `words/${word.id}`);
    }
  };

  // 表示は先頭 N 件だけに絞る（実装仕様書 F2-c）。
  // データ自体はローカルキャッシュ上に全件あり、復習・ナレッジマップ・
  // 書き出しはいずれも savedWords 全体を参照するので機能は制限されない。
  const visibleWords = filteredWords.slice(0, visibleCount);
  const hasMore = filteredWords.length > visibleWords.length;

  // Group words by date
  const groupedWords = visibleWords.reduce((acc, word) => {
    const date = format(word.timestamp, "yyyy/MM/dd");
    if (!acc[date]) acc[date] = [];
    acc[date].push(word);
    return acc;
  }, {} as Record<string, SavedWord[]>);

  const sortedDates = Object.keys(groupedWords).sort((a, b) => b.localeCompare(a));

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <Loader2 className="w-8 h-8 animate-spin text-[#2A5CFF]" />
      </div>
    );
  }

  // 未ログインではアプリ本体を描画しない。
  // 検索は AI 生成を伴うため、認証なしに叩ける経路を残さない（実装仕様書 F1）。
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm text-center"
        >
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/10 mb-8 mx-auto">
            <div className="w-12 h-12 bg-[#2A5CFF] rounded-2xl flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-[#1A1C1E] mb-3">
            Cortex Dictionary
          </h1>
          <p className="text-sm text-[#656E77] leading-relaxed mb-10">
            AIが専門分野や語源から知識の繋がりを生成する英単語辞書です。
            利用するにはログインしてください。
          </p>

          <Button
            onClick={handleLogin}
            className="w-full h-12 rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-200"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Google でログイン
          </Button>

          <p className="text-[10px] text-[#656E77]/70 mt-6 leading-relaxed">
            保存した単語はアカウントごとに管理され、他のユーザーからは見えません。
          </p>
        </motion.div>
        <Toaster position="bottom-right" richColors />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#F8F9FA] overflow-hidden relative">
      {/* Mobile Toggle */}
      <div className="lg:hidden fixed bottom-6 right-6 z-[100]">
        <Button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="w-14 h-14 rounded-full shadow-2xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center p-0"
        >
          {isSidebarOpen ? <ChevronLeft className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
        </Button>
      </div>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[80]"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:relative z-[90] h-full
        w-[280px] md:w-[320px] 
        bg-white border-r border-[#E5E7EB] flex flex-col transition-transform duration-300 ease-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b border-[#E5E7EB]">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#2A5CFF] rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
                <BookOpen className="text-white w-5 h-5" />
              </div>
              <h1 className="text-xl font-extrabold tracking-tight">Cortex Dictionary</h1>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsSidebarOpen(false)}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
          </div>

          <form onSubmit={handleSearch} className="relative group">
            <Input
              placeholder="単語を検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length > 1 && setShowSuggestions(true)}
              className="w-full pl-4 h-11 rounded-lg border-2 border-[#E5E7EB] bg-[#F1F3F5] focus:bg-white focus:border-[#2A5CFF] transition-all text-sm mb-3"
            />
            {loading && (
              <div className="absolute right-3 top-3">
                <Loader2 className="w-5 h-5 animate-spin text-[#2A5CFF]" />
              </div>
            )}
            
            <AnimatePresence>
              {showSuggestions && suggestions.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-0 right-0 z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-2 space-y-1 mb-4"
                >
                  <p className="px-3 py-1 text-[9px] font-black text-[#656E77] uppercase tracking-widest">History Suggestions</p>
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSearchQuery(s.word);
                        handleSearch(undefined, s.word);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-between"
                    >
                      <span className="text-xs font-bold text-gray-700">{s.word}</span>
                      <span className="text-[10px] text-gray-400 font-medium truncate ml-4 italic">{s.meaning.slice(0, 15)}...</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </form>

          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F1F3F5] rounded-xl mb-4">
            <button
              onClick={() => setDictionaryMode(DictionaryMode.GENERAL)}
              className={`flex flex-col items-center justify-center py-2 rounded-lg transition-all ${dictionaryMode === DictionaryMode.GENERAL ? 'bg-white shadow-sm text-[#2A5CFF]' : 'text-[#656E77] hover:bg-white/50'}`}
              title="一般"
            >
              <Globe className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-bold">一般</span>
            </button>
            <button
              onClick={() => setDictionaryMode(DictionaryMode.ACADEMIC)}
              className={`flex flex-col items-center justify-center py-2 rounded-lg transition-all ${dictionaryMode === DictionaryMode.ACADEMIC ? 'bg-white shadow-sm text-[#2A5CFF]' : 'text-[#656E77] hover:bg-white/50'}`}
              title="学術"
            >
              <GraduationCap className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-bold">学術</span>
            </button>
          </div>

          {/* デッキとタグの絞り込み（F7）。一覧・復習・マップに同時に効く。 */}
          <div className="flex gap-1.5 mb-2">
            <select
              value={filter.deckId === undefined ? "__all" : filter.deckId ?? "__none"}
              onChange={(e) => {
                const v = e.target.value;
                setFilter((f) => ({
                  ...f,
                  deckId: v === "__all" ? undefined : v === "__none" ? null : v,
                }));
                setVisibleCount(SIDEBAR_PAGE_SIZE);
              }}
              className="flex-1 h-9 px-2 rounded-lg border-2 border-[#E5E7EB] bg-white text-[11px] font-bold text-[#1A1C1E]"
            >
              <option value="__all">すべてのデッキ</option>
              <option value="__none">未分類</option>
              {decks.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDeckManagerOpen(true)}
              title="デッキを管理"
              className="w-9 h-9 shrink-0 rounded-lg border-2 border-[#E5E7EB] text-[#656E77] hover:text-[#2A5CFF]"
            >
              <Layers className="w-4 h-4" />
            </Button>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {allTags.slice(0, 12).map(({ tag, count }) => {
                const active = filter.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setFilter((f) => ({
                        ...f,
                        tags: active
                          ? f.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                          : [...f.tags, tag],
                      }))
                    }
                    className={`text-[10px] px-2 py-1 rounded-full font-bold border transition-colors ${
                      active
                        ? "bg-[#2A5CFF] text-white border-[#2A5CFF]"
                        : "bg-white text-[#656E77] border-[#E5E7EB] hover:border-[#2A5CFF]/40"
                    }`}
                  >
                    {tag} <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
              {isFilterActive(filter) && (
                <button
                  type="button"
                  onClick={() => setFilter({ tags: [] })}
                  className="text-[10px] px-2 py-1 rounded-full font-bold text-[#656E77] hover:text-red-500 flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  解除
                </button>
              )}
            </div>
          )}

          <Button
            onClick={() => setActiveTab("home")}
            variant="ghost"
            className={`w-full mt-2 justify-start font-bold text-xs h-10 rounded-lg ${activeTab === 'home' ? 'bg-[#E9F0FF] text-[#2A5CFF]' : 'text-[#656E77] hover:bg-gray-100'}`}
          >
            <Home className="w-4 h-4 mr-2" />
            今日の学習
          </Button>

          <Button
            onClick={() => setIsExtractOpen(true)}
            variant="ghost"
            className="w-full mt-2 justify-start text-[#656E77] hover:bg-gray-100 font-bold text-xs h-10 rounded-lg"
          >
            <ClipboardPaste className="w-4 h-4 mr-2" />
            英文から単語を集める
          </Button>

          <Button
            onClick={() => startFlashcards()}
            variant="ghost"
            className="w-full mt-2 justify-start text-[#2A5CFF] hover:bg-[#E9F0FF] font-bold text-xs h-10 rounded-lg"
          >
            <BrainCircuit className="w-4 h-4 mr-2" />
            単語カードで復習する
          </Button>

          {/* 中断したセッションの再開（実装仕様書 F3）。リロードやタブ移動で
              進行が失われないように localStorage から復元する。 */}
          {!review.session && review.resumable && (
            <div className="mt-2 p-3 rounded-xl bg-[#FFF7ED] border border-orange-100">
              <p className="text-[11px] font-bold text-orange-800 leading-snug mb-2">
                中断した復習が残っています（{review.resumable.index} / {review.resumable.queue.length} 枚）
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    review.resume();
                    setActiveTab("flashcards");
                  }}
                  className="flex-1 h-8 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold"
                >
                  再開する
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={review.discardResumable}
                  className="h-8 rounded-lg text-[11px] font-bold text-orange-700 hover:bg-orange-100"
                >
                  破棄
                </Button>
              </div>
            </div>
          )}

          <Button 
            onClick={() => setActiveTab("map")}
            variant="ghost" 
            className={`w-full mt-2 justify-start font-bold text-xs h-10 rounded-lg ${activeTab === 'map' ? 'bg-[#E9F0FF] text-[#2A5CFF]' : 'text-[#656E77] hover:bg-gray-100'}`}
          >
            <MapIcon className="w-4 h-4 mr-2" />
            語彙ナレッジマップ
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 pt-2">
            {!user ? (
              <div className="text-center py-12 px-4">
                <User className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-xs text-[#656E77] mb-4">保存するにはログインが必要です</p>
                <Button onClick={handleLogin} size="sm" className="w-full bg-[#2A5CFF] rounded-lg">ログイン</Button>
              </div>
            ) : filteredWords.length === 0 ? (
              <div className="text-center py-12 px-4">
                <History className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-xs text-[#656E77]">
                  {isFilterActive(filter)
                    ? "この絞り込みに該当する単語はありません"
                    : "保存された単語はありません"}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {sortedDates.map(date => (
                  <div key={date}>
                    <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-wider mb-3 flex items-center gap-2">
                      {date}
                    </h3>
                    <div className="space-y-1">
                      {groupedWords[date].map((word) => (
                        <div
                          key={word.id}
                          onClick={() => {
                            setResult(word);
                            setActiveTab("detail");
                          }}
                          className={`group p-3 rounded-lg cursor-pointer transition-all border border-transparent hover:bg-[#F1F3F5] ${result?.word === word.word && activeTab === 'detail' ? 'bg-[#E9F0FF] border-[#2A5CFF]/10' : ''}`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className={`font-bold text-sm break-words flex items-center justify-between ${result?.word === word.word ? 'text-[#2A5CFF]' : 'text-[#1A1C1E]'}`}>
                                <span>{word.word}</span>
                                {word.mode && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-normal uppercase tracking-tighter">
                                    {word.mode === DictionaryMode.GENERAL ? 'Gen' : word.mode === DictionaryMode.ACADEMIC ? 'Aca' : 'Eng'}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#656E77] line-clamp-2 mt-1 leading-tight">
                                {word.meaning}
                              </div>
                              {word.nextReviewAt && (
                                <div className={`flex items-center gap-1.5 mt-1.5 text-[9px] font-bold ${word.nextReviewAt < Date.now() ? 'text-red-500' : 'text-blue-500/70'}`}>
                                  <div className={`w-1 h-1 rounded-full ${word.nextReviewAt < Date.now() ? 'bg-red-500 animate-pulse' : 'bg-blue-300'}`} />
                                  <span>Review: {format(word.nextReviewAt, "MM/dd HH:mm", { locale: ja })}</span>
                                </div>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteWord(word.id);
                              }}
                              className="w-6 h-6 shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {hasMore && (
                  <Button
                    variant="ghost"
                    onClick={() => setVisibleCount((n) => n + SIDEBAR_PAGE_SIZE)}
                    className="w-full text-xs font-bold text-[#2A5CFF] hover:bg-[#E9F0FF] rounded-lg h-10"
                  >
                    さらに表示（残り {filteredWords.length - visibleWords.length} 件）
                  </Button>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {user && (
          <div className="p-4 border-t border-[#E5E7EB] bg-white space-y-2">
            {/* 一括取り込みした単語の詳細生成の進捗（F5） */}
            {enriching.remaining > 0 && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#F0F4FF]">
                <Loader2 className="w-3 h-3 text-[#2A5CFF] animate-spin shrink-0" />
                <span className="text-[10px] font-bold text-[#2A5CFF]">
                  詳細を生成中 残り {enriching.remaining} 語
                </span>
              </div>
            )}
            <Button
              onClick={() => setIsDataModalOpen(true)}
              variant="ghost"
              className="w-full justify-start text-[#656E77] hover:bg-gray-100 font-bold text-xs h-9 rounded-lg"
            >
              <Download className="w-4 h-4 mr-2" />
              データの書き出し / 復元
            </Button>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={user.photoURL || ""} alt="" className="w-8 h-8 rounded-full border border-gray-100" referrerPolicy="no-referrer" />
                <span className="text-xs font-bold truncate max-w-[120px]">{user.displayName}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={handleLogout} className="text-[#656E77] hover:text-red-500">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 h-full overflow-y-auto bg-[#F8F9FA] p-4 md:p-8 lg:p-12">
        <AnimatePresence mode="wait">
          {activeTab === "home" ? (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Dashboard
                words={filteredWords}
                decks={decks.decks}
                stats={userStats}
                enriching={enriching}
                onStartReview={startFlashcards}
                onOpenExtract={() => setIsExtractOpen(true)}
                onSelectDeck={(deckId) => {
                  setFilter((f) => ({ ...f, deckId }));
                  setVisibleCount(SIDEBAR_PAGE_SIZE);
                }}
              />
            </motion.div>
          ) : activeTab === "map" ? (
             <motion.div
               key="map"
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="h-full"
             >
               <KnowledgeMap
                 words={filteredWords}
                 onWordClick={(w) => {
                   setResult(w);
                   setActiveTab("detail");
                 }} 
               />
             </motion.div>
          ) : activeTab === "flashcards" && review.session ? (
            <ReviewMode
              key="flashcards"
              api={review}
              onGrade={handleReview}
              onExit={exitFlashcards}
            />
          ) : loading ? (
             <motion.div
               key="skeleton"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="h-full flex flex-col"
             >
               <WordSkeleton />
             </motion.div>
          ) : result ? (
            <motion.div
              key={result.word}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="max-w-4xl mx-auto flex flex-col h-full"
            >
              <div className="flex justify-between items-start mb-10">
                <div className="word-title-group min-w-0 pr-4">
                  <div className="flex items-center gap-4 mb-2">
                    <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-[#1A1C1E] break-all md:break-words">{result.word}</h1>
                    {ttsAvailable && result.word && (
                      <button
                        type="button"
                        onClick={() => speak(result.word, loadTtsSettings())}
                        title="発音を再生"
                        className="w-11 h-11 shrink-0 rounded-full bg-white border border-[#E5E7EB] text-[#2A5CFF] flex items-center justify-center hover:bg-[#E9F0FF] hover:border-[#2A5CFF]/30 transition-colors"
                      >
                        <Volume2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  {formatPhonetic(result.phonetic) && (
                    <p className="text-base md:text-lg text-[#656E77] font-medium tracking-wide mb-3">
                      {formatPhonetic(result.phonetic)}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <span className="inline-block px-3 py-1 bg-[#E9F0FF] text-[#2A5CFF] text-sm font-bold rounded-md">
                      {result.grammar}
                    </span>
                     {('mode' in result || dictionaryMode) && (
                      <span className="inline-block px-3 py-1 bg-[#F1F3F5] text-[#656E77] text-sm font-bold rounded-md flex items-center gap-1.5">
                        {(() => {
                           const m = ('mode' in result ? (result as SavedWord).mode : dictionaryMode);
                           if (m === DictionaryMode.ACADEMIC) return <GraduationCap className="w-3.5 h-3.5" />;
                           return <Globe className="w-3.5 h-3.5" />;
                        })()}
                        {('mode' in result ? (result as SavedWord).mode : dictionaryMode)}
                      </span>
                    )}
                    {result.category && (
                      <span className="inline-block px-3 py-1 bg-[#2A5CFF]/10 text-[#2A5CFF] text-sm font-bold rounded-md border border-[#2A5CFF]/20">
                        {result.category}
                      </span>
                    )}
                  </div>
                </div>
                <Button 
                  onClick={saveWord}
                  variant="outline" 
                  className="rounded-full border-2 border-[#2A5CFF] text-[#2A5CFF] font-bold hover:bg-[#E9F0FF] px-6"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  リストに追加
                </Button>
              </div>

              {/* タグ / デッキ（F7）。保存済みの単語にのみ出す。 */}
              {(result as SavedWord).id && (
                <div className="flex flex-wrap items-center gap-2 mb-8 -mt-4">
                  <select
                    value={(result as SavedWord).deckId ?? ""}
                    onChange={(e) => moveToDeck(result as SavedWord, e.target.value || null)}
                    className="h-8 px-2 rounded-lg border border-[#E5E7EB] bg-white text-[11px] font-bold text-[#656E77]"
                  >
                    <option value="">未分類</option>
                    {decks.decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  {((result as SavedWord).tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="h-8 pl-3 pr-1.5 rounded-lg bg-[#F1F3F5] text-[11px] font-bold text-[#1A1C1E] flex items-center gap-1"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() =>
                          updateTags(
                            result as SavedWord,
                            ((result as SavedWord).tags ?? []).filter((t) => t !== tag)
                          )
                        }
                        className="w-5 h-5 rounded flex items-center justify-center text-[#656E77] hover:text-red-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}

                  <div className="flex items-center gap-1 h-8 px-2 rounded-lg border border-dashed border-[#E5E7EB]">
                    <TagIcon className="w-3 h-3 text-[#656E77]" />
                    <input
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || !tagDraft.trim()) return;
                        updateTags(result as SavedWord, [
                          ...((result as SavedWord).tags ?? []),
                          tagDraft,
                        ]);
                        setTagDraft("");
                      }}
                      list="cortex-tag-suggestions"
                      placeholder="タグを追加"
                      className="w-24 bg-transparent text-[11px] font-bold outline-none placeholder:text-[#656E77]/60"
                    />
                    <datalist id="cortex-tag-suggestions">
                      {allTags.map(({ tag }) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  </div>
                </div>
              )}

              {(result as SavedWord).enrichStatus === "pending" && (
                <div className="mb-6 p-4 rounded-2xl bg-[#F0F4FF] border border-[#2A5CFF]/15 flex items-center gap-3">
                  <Loader2 className="w-4 h-4 text-[#2A5CFF] animate-spin" />
                  <p className="text-xs font-bold text-[#2A5CFF]">
                    この単語の詳細を生成中です。しばらくすると例文や語源が表示されます。
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
                <Card className="md:col-span-2 border border-[#E5E7EB] shadow-none rounded-2xl overflow-hidden">
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">Meaning / 意味</h3>
                      <div className="flex-1 h-[1px] bg-[#E5E7EB]" />
                    </div>
                    <p className="text-2xl font-bold text-[#1A1C1E] leading-snug">
                      {result.meaning}
                    </p>
                  </CardContent>
                </Card>

                <Card className="md:col-span-2 border border-[#E9F0FF] bg-[#F0F4FF] shadow-none rounded-2xl overflow-hidden">
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="text-[11px] font-bold text-[#2A5CFF] uppercase tracking-widest">Nuance / 使い分け</h3>
                      <div className="flex-1 h-[1px] bg-[#2A5CFF]/20" />
                    </div>
                    <p className="text-lg font-medium text-[#1A1C1E] leading-relaxed">
                      {result.nuance}
                    </p>
                  </CardContent>
                </Card>

                <Card className="md:col-span-2 border border-[#F1F3F5] bg-white shadow-none rounded-2xl overflow-hidden">
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">Etymology / 語源</h3>
                      <div className="flex-1 h-[1px] bg-[#E5E7EB]" />
                    </div>
                    <p className="text-base font-medium text-[#656E77] leading-relaxed italic mb-8">
                      {result.etymology}
                    </p>
                    {result.etymologyNodes && (
                      <EtymologyGraph mainWord={result.word} nodes={result.etymologyNodes} />
                    )}
                  </CardContent>
                </Card>

                {result.specializedContexts && result.specializedContexts.length > 0 && (
                  <Card className="md:col-span-2 border border-[#E5E7EB] shadow-none rounded-2xl overflow-hidden">
                    <CardContent className="p-8">
                      <div className="flex items-center gap-3 mb-6">
                        <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">Multi-Field Perspectives / 専門文脈</h3>
                        <div className="flex-1 h-[1px] bg-[#E5E7EB]" />
                      </div>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {result.specializedContexts.map((ctx, i) => {
                          const field = ctx.field.toLowerCase();
                          let icon = <BrainCircuit className="w-4 h-4" />;
                          let color = "bg-gray-50 text-gray-700 border-gray-100";
                          
                          const fieldMatchers = [
                            { keys: ["engineering", "tech", "mechanic", "physics"], icon: <Hammer className="w-4 h-4" />, color: "bg-blue-50 text-blue-700 border-blue-100" },
                            { keys: ["finance", "business", "econ", "market"], icon: <Coins className="w-4 h-4" />, color: "bg-emerald-50 text-emerald-700 border-emerald-100" },
                            { keys: ["motor", "car", "f1", "race", "auto"], icon: <Trophy className="w-4 h-4" />, color: "bg-orange-50 text-orange-700 border-orange-100" },
                            { keys: ["med", "bio", "health", "anatomy", "pharm"], icon: <Activity className="w-4 h-4" />, color: "bg-red-50 text-red-700 border-red-100" },
                            { keys: ["law", "legal", "politic", "court"], icon: <Gavel className="w-4 h-4" />, color: "bg-indigo-50 text-indigo-700 border-indigo-100" },
                            { keys: ["psych", "mind", "brain", "behavio"], icon: <BrainCircuit className="w-4 h-4" />, color: "bg-purple-50 text-purple-700 border-purple-100" },
                            { keys: ["art", "design", "music", "creat", "paint"], icon: <Plus className="w-4 h-4" />, color: "bg-pink-50 text-pink-700 border-pink-100" },
                            { keys: ["code", "soft", "program", "alg"], icon: <Code className="w-4 h-4" />, color: "bg-slate-50 text-slate-700 border-slate-100" },
                          ];

                          const match = fieldMatchers.find(m => m.keys.some(k => field.includes(k)));
                          if (match) {
                            icon = match.icon;
                            color = match.color;
                          }

                          return (
                            <div key={i} className={`p-5 rounded-2xl border ${color} flex flex-col gap-4 transition-all hover:shadow-lg hover:shadow-gray-200/40 bg-white/50 backdrop-blur-sm`}>
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-xl shadow-sm border border-inherit/20">
                                  {icon}
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-wider">{ctx.field}</span>
                              </div>
                              <p className="text-xs font-semibold leading-relaxed text-inherit opacity-90">
                                {ctx.context}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="border border-[#E5E7EB] shadow-none rounded-2xl overflow-hidden">
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">Examples / 例文</h3>
                      <div className="flex-1 h-[1px] bg-[#E5E7EB]" />
                    </div>
                    <div className="space-y-6">
                      {normalizeExamples(result.examples).map((ex, i) => (
                        <div key={i} className="pl-4 border-l-4 border-[#E5E7EB]">
                          <div className="flex items-start gap-2 mb-1">
                            <p className="text-[#1A1C1E] font-bold text-base flex-1">{ex.en}</p>
                            {ttsAvailable && ex.en && (
                              <button
                                type="button"
                                onClick={() => speak(ex.en, loadTtsSettings())}
                                title="例文を読み上げる"
                                className="w-7 h-7 shrink-0 rounded-full text-[#656E77] hover:text-[#2A5CFF] hover:bg-[#E9F0FF] flex items-center justify-center transition-colors"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="text-[#656E77] text-sm">{ex.ja}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-[#E5E7EB] shadow-none rounded-2xl overflow-hidden">
                  <CardContent className="p-8 space-y-8">
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">Synonyms / 類義語</h3>
                        <div className="flex-1 h-[1px] bg-[#E5E7EB]" />
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {result.synonyms.map((s, i) => (
                          <div key={i} className="px-3 py-2 bg-[#F1F3F5] rounded-xl flex flex-col items-center">
                            <span className="text-[#1A1C1E] text-sm font-bold">{s.word}</span>
                            <span className="text-[10px] text-[#656E77]">{s.translation}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <h3 className="text-[11px] font-bold text-[#656E77] uppercase tracking-widest">Antonyms / 対義語</h3>
                        <div className="flex-1 h-[1px] bg-[#E5E7EB]" />
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {result.antonyms.map((a, i) => (
                          <div key={i} className="px-3 py-2 bg-[#F1F3F5] rounded-xl flex flex-col items-center">
                            <span className="text-[#1A1C1E] text-sm font-bold">{a.word}</span>
                            <span className="text-[10px] text-[#656E77]">{a.translation}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 max-w-2xl mx-auto">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-20 md:w-24 h-20 md:h-24 bg-white rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/10 mb-8"
              >
                <div className="w-12 md:w-16 h-12 md:h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
                  <Search className="w-6 md:w-8 h-6 md:h-8 text-blue-600" />
                </div>
              </motion.div>
              
              <h2 className="text-3xl md:text-4xl font-black text-[#1A1C1E] mb-3 tracking-tight">Cortex Dictionary</h2>
              
              <p className="text-[#656E77] text-sm md:text-base mb-10 max-w-md">
                調べたい英単語を入力してください。AIが専門分野や語源から知識の繋がりを生成します。
              </p>

              <form onSubmit={handleSearch} className="w-full relative max-w-lg">
                <div className="relative group">
                  <Input
                    placeholder="単語を入力して知識を広げる..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-6 pr-16 h-16 md:h-20 rounded-2xl md:rounded-3xl border-2 border-[#E5E7EB] bg-white shadow-xl shadow-gray-200/50 focus:border-[#2A5CFF] focus:ring-0 transition-all text-lg md:text-xl font-bold"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <Button 
                      type="submit"
                      disabled={loading || !searchQuery.trim()}
                      className="w-10 md:w-12 h-10 md:h-12 rounded-xl md:rounded-2xl bg-[#2A5CFF] hover:bg-blue-700 text-white shadow-lg shadow-blue-200 p-0"
                    >
                      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-6 h-6" />}
                    </Button>
                  </div>
                </div>
                
                <div className="mt-8 h-4" />
              </form>
            </div>
          )}
        </AnimatePresence>
      </main>
      {user && (
        <>
          <DataTransferModal
            open={isDataModalOpen}
            onClose={() => setIsDataModalOpen(false)}
            uid={user.uid}
            wordCount={savedWords.length}
          />
          <DeckManager
            open={isDeckManagerOpen}
            onClose={() => setIsDeckManagerOpen(false)}
            api={decks}
            words={savedWords}
          />
          <BulkExtractModal
            open={isExtractOpen}
            onClose={() => setIsExtractOpen(false)}
            uid={user.uid}
            words={savedWords}
            decks={decks.decks}
            mode={dictionaryMode}
          />
        </>
      )}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
