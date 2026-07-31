/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
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
  Download
} from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { lookupWord, planNextReview, getCachedWord } from "./services/geminiService";
import { coerceWordDetail } from "./lib/normalize";
import { WordDetail, SavedWord, DictionaryMode, ReviewRating, ReviewSession } from "./types";
import { EtymologyGraph } from "./components/EtymologyGraph";
import { KnowledgeMap } from "./components/KnowledgeMap";
import { DataTransferModal } from "./components/DataTransferModal";
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
  getDocFromServer
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
  const [activeTab, setActiveTab] = useState<"detail" | "flashcards" | "map">("detail");
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [flashcardList, setFlashcardList] = useState<SavedWord[]>([]);
  const [dictionaryMode, setDictionaryMode] = useState<DictionaryMode>(DictionaryMode.GENERAL);
  const [suggestions, setSuggestions] = useState<SavedWord[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Real-time Firestore listener
  useEffect(() => {
    if (!user) {
      setSavedWords([]);
      return;
    }

    const q = query(
      collection(db, "words"),
      where("userId", "==", user.uid)
      // orderBy("timestamp", "desc") // Removed to avoid index requirement
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const words = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedWord[];
      
      // Sort manually by timestamp desc for list display
      const listSorted = [...words].sort((a, b) => b.timestamp - a.timestamp);
      setSavedWords(listSorted);

      // Sort by nextReviewAt for flashcards (due or priority first)
      // Words with nextReviewAt in the past or lower value are shown first
      const reviewSorted = [...words].sort((a, b) => {
        const timeA = a.nextReviewAt || 0;
        const timeB = b.nextReviewAt || 0;
        return timeA - timeB;
      });
      setFlashcardList(reviewSorted);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "words");
    });

    return () => unsubscribe();
  }, [user]);

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

  const handleReview = async (rating: ReviewRating) => {
    if (!user || flashcardList.length === 0) return;
    const word = flashcardList[flashcardIndex];
    
    // UIを即座に更新（次のカードへ遷移）
    setIsFlipped(false);
    
    // さらに高速に（100msで切り替え）
    setTimeout(() => {
      nextFlashcard();
    }, 100);
    
    // 非同期でAI分析とDB保存を実行（ユーザーを待たせない）
    const session: ReviewSession = { rating, timestamp: Date.now() };
    const updatedHistory = [...(word.reviewHistory || []), session];
    
    // バックグラウンドでの非同期処理
    (async () => {
      try {
        const { nextReviewAt, aiAnalysis } = await planNextReview({ ...word, reviewHistory: updatedHistory });
        const wordRef = doc(db, "words", word.id);
        await updateDoc(wordRef, {
          reviewHistory: updatedHistory,
          nextReviewAt,
          aiAnalysis
        });
        // 成功通知は控えめにするか、出さない（スムーズさを優先）
        console.debug(`Memory optimized for: ${word.word}`);
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
      const wordData = {
        ...result,
        userId: user.uid,
        timestamp: Date.now(),
        mode: dictionaryMode,
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

  const startFlashcards = () => {
    if (flashcardList.length === 0) {
      toast.error("保存された単語がありません。");
      return;
    }
    setFlashcardIndex(0);
    setIsFlipped(false);
    setActiveTab("flashcards");
  };

  const nextFlashcard = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setFlashcardIndex((prev) => (prev + 1) % flashcardList.length);
    }, 150);
  };

  const prevFlashcard = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setFlashcardIndex((prev) => (prev - 1 + flashcardList.length) % flashcardList.length);
    }, 150);
  };

  // Group words by date
  const groupedWords = savedWords.reduce((acc, word) => {
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

          <Button 
            onClick={startFlashcards}
            variant="ghost" 
            className="w-full mt-4 justify-start text-[#2A5CFF] hover:bg-[#E9F0FF] font-bold text-xs h-10 rounded-lg"
          >
            <BrainCircuit className="w-4 h-4 mr-2" />
            単語カードで復習する
          </Button>

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
            ) : savedWords.length === 0 ? (
              <div className="text-center py-12 px-4">
                <History className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-xs text-[#656E77]">保存された単語はありません</p>
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
              </div>
            )}
          </div>
        </ScrollArea>

        {user && (
          <div className="p-4 border-t border-[#E5E7EB] bg-white space-y-2">
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
          {activeTab === "map" ? (
             <motion.div
               key="map"
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="h-full"
             >
               <KnowledgeMap 
                 words={savedWords} 
                 onWordClick={(w) => {
                   setResult(w);
                   setActiveTab("detail");
                 }} 
               />
             </motion.div>
          ) : activeTab === "flashcards" && flashcardList.length > 0 ? (
            <motion.div
              key="flashcards"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-xl mx-auto flex flex-col h-full items-center justify-center py-6"
            >
              <div className="w-full flex justify-between items-center mb-8 md:mb-12">
                <div>
                  <h2 className="text-2xl font-black text-[#1A1C1E]">復習モード</h2>
                  <p className="text-xs text-[#656E77] font-bold uppercase tracking-widest mt-1">
                    Card {flashcardIndex + 1} of {flashcardList.length}
                  </p>
                </div>
                <Button 
                  variant="ghost" 
                  onClick={() => setActiveTab("detail")}
                  className="text-[#656E77] hover:text-[#1A1C1E] font-bold text-xs"
                >
                  終了する
                </Button>
              </div>

              <div className="relative w-full aspect-[4/5] md:aspect-[4/3] perspective-1000 group cursor-pointer" onClick={() => setIsFlipped(!isFlipped)}>
                <motion.div 
                   className="w-full h-full relative preserve-3d transition-transform duration-500"
                   animate={{ rotateY: isFlipped ? 180 : 0 }}
                >
                  {/* Front */}
                  <div className="absolute inset-0 backface-hidden bg-white rounded-3xl border border-[#E5E7EB] shadow-xl flex flex-col items-center justify-center p-8 md:p-12 text-center">
                    <div className="flex flex-col items-center gap-2 mb-4">
                      <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em]">Word</span>
                      {flashcardList[flashcardIndex].mode && (
                        <span className="text-[9px] px-2 py-0.5 bg-[#F1F3F5] text-[#656E77] rounded-full font-bold uppercase tracking-widest border border-[#E5E7EB]">
                          {flashcardList[flashcardIndex].mode}
                        </span>
                      )}
                    </div>
                    <h3 className="text-3xl md:text-5xl font-black tracking-tighter text-[#1A1C1E]">{flashcardList[flashcardIndex].word}</h3>
                    <p className="mt-8 text-[10px] md:text-xs text-[#656E77] flex items-center gap-2">
                       <RotateCw className="w-3 h-3" />
                       クリックして裏面を表示
                    </p>
                  </div>

                  {/* Back */}
                  <div className="absolute inset-0 backface-hidden rotate-y-180 bg-[#E9F0FF] rounded-3xl border border-[#2A5CFF]/20 shadow-xl flex flex-col p-10 overflow-auto">
                    <div className="mb-6">
                      <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Meaning</span>
                      <p className="text-2xl font-bold text-[#1A1C1E]">{flashcardList[flashcardIndex].meaning}</p>
                    </div>

                    <div className="mb-6">
                      <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Grammar</span>
                      <p className="text-sm font-bold text-[#1A1C1E] inline-block px-2 py-0.5 bg-white/50 rounded">{flashcardList[flashcardIndex].grammar}</p>
                    </div>

                    {flashcardList[flashcardIndex].nuance && (
                      <div className="mb-6">
                        <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Nuance / 使い分け</span>
                        <p className="text-sm font-medium text-[#1A1C1E] leading-relaxed bg-white/30 p-3 rounded-xl border border-white/40">
                          {flashcardList[flashcardIndex].nuance}
                        </p>
                      </div>
                    )}

                    {flashcardList[flashcardIndex].specializedContexts && flashcardList[flashcardIndex].specializedContexts.length > 0 && (
                      <div className="mb-6">
                        <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Professional Perspectives</span>
                        <div className="space-y-2">
                          {flashcardList[flashcardIndex].specializedContexts.slice(0, 2).map((ctx, i) => (
                            <div key={i} className="text-[10px] font-medium text-[#1A1C1E] bg-white/40 p-2 rounded-lg border border-white/50">
                              <span className="font-bold text-[#2A5CFF] mr-2">[{ctx.field}]</span>
                              {ctx.context}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <span className="text-[10px] font-bold text-[#2A5CFF] uppercase tracking-[0.2em] mb-2 block">Example</span>
                      <p className="text-sm font-medium text-[#1A1C1E] leading-relaxed italic border-l-2 border-[#2A5CFF]/30 pl-3">
                        {flashcardList[flashcardIndex].examples[0]?.split('\n')[0]}
                      </p>
                    </div>

                    <p className="mt-auto pt-4 text-center text-[10px] font-bold text-[#2A5CFF]/60 uppercase tracking-widest">
                       Click to Flip Back
                    </p>
                  </div>
                </motion.div>
              </div>

              {isFlipped && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mt-8 md:mt-12 w-full"
                >
                  <Button 
                    onClick={(e) => { e.stopPropagation(); handleReview(ReviewRating.AGAIN); }}
                    className="flex flex-col h-14 md:h-16 rounded-2xl bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 p-2"
                  >
                    <span className="text-xs font-black">AGAIN</span>
                    <span className="text-[9px] md:text-[10px] opacity-70">忘れた</span>
                  </Button>
                  <Button 
                    onClick={(e) => { e.stopPropagation(); handleReview(ReviewRating.HARD); }}
                    className="flex flex-col h-14 md:h-16 rounded-2xl bg-orange-50 text-orange-600 border border-orange-100 hover:bg-orange-100 p-2"
                  >
                    <span className="text-xs font-black">HARD</span>
                    <span className="text-[9px] md:text-[10px] opacity-70">難しい</span>
                  </Button>
                  <Button 
                    onClick={(e) => { e.stopPropagation(); handleReview(ReviewRating.GOOD); }}
                    className="flex flex-col h-14 md:h-16 rounded-2xl bg-green-50 text-green-600 border border-green-100 hover:bg-green-100 p-2"
                  >
                    <span className="text-xs font-black">GOOD</span>
                    <span className="text-[9px] md:text-[10px] opacity-70">覚えた</span>
                  </Button>
                  <Button 
                    onClick={(e) => { e.stopPropagation(); handleReview(ReviewRating.EASY); }}
                    className="flex flex-col h-14 md:h-16 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 p-2"
                  >
                    <span className="text-xs font-black">EASY</span>
                    <span className="text-[9px] md:text-[10px] opacity-70">余裕</span>
                  </Button>
                </motion.div>
              )}

              {flashcardList[flashcardIndex].aiAnalysis && !isFlipped && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-6 p-4 bg-orange-50 rounded-2xl border border-orange-100 max-w-md"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <BrainCircuit className="w-4 h-4 text-orange-500" />
                    <span className="text-[10px] font-bold text-orange-600 uppercase tracking-widest">AI Retention Insight</span>
                  </div>
                  <p className="text-xs text-orange-800 leading-relaxed">
                    {flashcardList[flashcardIndex].aiAnalysis}
                  </p>
                </motion.div>
              )}

              <div className="flex gap-4 mt-8 md:mt-12 w-full">
                <Button 
                  onClick={(e) => { e.stopPropagation(); prevFlashcard(); }}
                  variant="outline"
                  className="flex-1 h-12 md:h-14 rounded-2xl border-2 border-[#E5E7EB] hover:border-[#2A5CFF] hover:text-[#2A5CFF] group text-xs md:text-sm"
                >
                  <ChevronLeft className="w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2 group-hover:-translate-x-1 transition-transform" />
                  前の単語
                </Button>
                <Button 
                  onClick={(e) => { e.stopPropagation(); nextFlashcard(); }}
                  variant="outline"
                  className="flex-1 h-12 md:h-14 rounded-2xl border-2 border-[#E5E7EB] hover:border-[#2A5CFF] hover:text-[#2A5CFF] group text-xs md:text-sm"
                >
                  次の単語
                  <ChevronRight className="w-4 h-4 md:w-5 md:h-5 ml-1 md:ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </motion.div>
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
                  <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-[#1A1C1E] mb-2 break-all md:break-words">{result.word}</h1>
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
                      {result.examples.map((ex, i) => (
                        <div key={i} className="pl-4 border-l-4 border-[#E5E7EB]">
                          <p className="text-[#1A1C1E] font-bold text-base mb-1">{ex.split('\n')[0]}</p>
                          <p className="text-[#656E77] text-sm">{ex.split('\n')[1]}</p>
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
        <DataTransferModal
          open={isDataModalOpen}
          onClose={() => setIsDataModalOpen(false)}
          uid={user.uid}
          wordCount={savedWords.length}
        />
      )}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
