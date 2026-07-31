/**
 * データのエクスポート / インポート用モーダル（実装仕様書 F8）。
 */

import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Download,
  Upload,
  X,
  Loader2,
  FileJson,
  FileSpreadsheet,
  Layers,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  buildExportBundle,
  downloadBlob,
  exportFileName,
  toAnkiBlob,
  toCsvBlob,
  toJsonBlob,
  type ExportFormat,
} from "../lib/exportData";
import {
  applyImport,
  planImport,
  ImportValidationError,
  type ConflictStrategy,
  type ImportPlan,
  type ImportResult,
} from "../lib/importData";

interface Props {
  open: boolean;
  onClose: () => void;
  uid: string;
  wordCount: number;
}

const EXPORT_OPTIONS: {
  format: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    format: "json",
    label: "JSON（完全バックアップ）",
    description: "すべての項目をそのまま保存します。このアプリに復元できる唯一の形式です。",
    icon: <FileJson className="w-5 h-5" />,
  },
  {
    format: "csv",
    label: "CSV（表計算ソフト用）",
    description: "Excel やスプレッドシートで開けます。復元には使えません。",
    icon: <FileSpreadsheet className="w-5 h-5" />,
  },
  {
    format: "anki",
    label: "Anki（TSV）",
    description: "Anki にインポートできる 表面 / 裏面 / タグ の3列形式です。",
    icon: <Layers className="w-5 h-5" />,
  },
];

const STRATEGY_OPTIONS: { value: ConflictStrategy; label: string; description: string }[] = [
  {
    value: "skip",
    label: "スキップ（推奨）",
    description: "既にある単語はそのまま残し、新しい単語だけを追加します。",
  },
  {
    value: "overwrite",
    label: "上書き",
    description: "既にある単語の内容をファイルの内容で置き換えます。保存日は変わりません。",
  },
  {
    value: "duplicate",
    label: "両方残す",
    description: "重複していても別の単語として追加します。",
  },
];

export const DataTransferModal: React.FC<Props> = ({ open, onClose, uid, wordCount }) => {
  const [tab, setTab] = useState<"export" | "import">("export");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>("skip");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPlan(null);
    setResult(null);
    setProgress(null);
    setStrategy("skip");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleExport = async (format: ExportFormat) => {
    setBusy(true);
    try {
      const bundle = await buildExportBundle(uid);
      if (bundle.words.length === 0) {
        toast.error("エクスポートできる単語がありません。");
        return;
      }
      const deckNames = new Map(
        bundle.decks.map((d) => [String(d.id), String(d.name ?? d.id)])
      );
      const blob =
        format === "json"
          ? toJsonBlob(bundle)
          : format === "csv"
          ? toCsvBlob(bundle, deckNames)
          : toAnkiBlob(bundle, deckNames);

      downloadBlob(blob, exportFileName(format));
      toast.success(`${bundle.words.length} 件をエクスポートしました。`);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("エクスポートに失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const nextPlan = await planImport(text, uid);
      setPlan(nextPlan);
    } catch (error) {
      console.error("Import dry-run failed:", error);
      toast.error(
        error instanceof ImportValidationError
          ? error.message
          : "ファイルを読み込めませんでした。"
      );
      reset();
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!plan) return;
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await applyImport(plan, uid, strategy, (done, total) =>
        setProgress({ done, total })
      );
      setResult(res);
      setPlan(null);
      toast.success(`${res.created} 件を追加しました。`);
    } catch (error) {
      console.error("Import failed:", error);
      toast.error("インポートに失敗しました。途中まで追加された単語は残っています。");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const willWrite =
    plan &&
    (plan.toCreate.length > 0 ||
      (strategy !== "skip" && plan.duplicates.length > 0));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="data-transfer-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        >
          <div
            onClick={handleClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            className="relative w-full max-w-lg"
          >
            <div className="w-full max-h-[85vh] overflow-y-auto bg-white rounded-3xl shadow-2xl border border-[#E5E7EB]">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-[#E5E7EB] sticky top-0 bg-white rounded-t-3xl">
                <h2 className="text-lg font-black tracking-tight">データの書き出し / 復元</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  disabled={busy}
                  className="text-[#656E77] hover:text-[#1A1C1E]"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#F1F3F5] rounded-xl m-6 mb-4">
                <button
                  onClick={() => { setTab("export"); reset(); }}
                  disabled={busy}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                    tab === "export"
                      ? "bg-white shadow-sm text-[#2A5CFF]"
                      : "text-[#656E77] hover:bg-white/50"
                  }`}
                >
                  <Download className="w-4 h-4" />
                  書き出し
                </button>
                <button
                  onClick={() => { setTab("import"); reset(); }}
                  disabled={busy}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                    tab === "import"
                      ? "bg-white shadow-sm text-[#2A5CFF]"
                      : "text-[#656E77] hover:bg-white/50"
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  復元
                </button>
              </div>

              <div className="px-6 pb-6">
                {tab === "export" ? (
                  <div className="space-y-3">
                    <p className="text-xs text-[#656E77] leading-relaxed">
                      保存済みの <span className="font-bold text-[#1A1C1E]">{wordCount}</span> 件を書き出します。
                      アプリを変更する前に、JSON でバックアップを取っておくことをおすすめします。
                    </p>
                    {EXPORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.format}
                        onClick={() => handleExport(opt.format)}
                        disabled={busy}
                        className="w-full text-left p-4 rounded-2xl border border-[#E5E7EB] hover:border-[#2A5CFF] hover:bg-[#F0F4FF] transition-all disabled:opacity-50 flex items-start gap-4"
                      >
                        <div className="p-2 bg-[#E9F0FF] text-[#2A5CFF] rounded-xl shrink-0">
                          {opt.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#1A1C1E]">{opt.label}</div>
                          <div className="text-[11px] text-[#656E77] mt-0.5 leading-relaxed">
                            {opt.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 結果表示 */}
                    {result ? (
                      <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-100">
                        <div className="flex items-center gap-2 mb-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          <span className="text-sm font-black text-emerald-800">復元が完了しました</span>
                        </div>
                        <ul className="text-xs text-emerald-900 space-y-1 font-medium">
                          <li>追加: {result.created} 件</li>
                          {result.overwritten > 0 && <li>上書き: {result.overwritten} 件</li>}
                          {result.skipped > 0 && <li>スキップ（既存）: {result.skipped} 件</li>}
                          {result.invalid > 0 && <li>取り込めなかった項目: {result.invalid} 件</li>}
                        </ul>
                        <Button
                          onClick={reset}
                          variant="outline"
                          className="mt-4 w-full rounded-xl text-xs font-bold"
                        >
                          別のファイルを読み込む
                        </Button>
                      </div>
                    ) : !plan ? (
                      <>
                        <p className="text-xs text-[#656E77] leading-relaxed">
                          エクスポートした <span className="font-bold">JSON ファイル</span> を選ぶと、
                          何件追加されるかを先に表示します。確認してから実行できます。
                        </p>
                        <input
                          ref={fileRef}
                          type="file"
                          accept="application/json,.json"
                          onChange={handleFileSelected}
                          disabled={busy}
                          className="block w-full text-xs text-[#656E77] file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#E9F0FF] file:text-[#2A5CFF] hover:file:bg-[#DBE6FF] file:cursor-pointer cursor-pointer"
                        />
                      </>
                    ) : (
                      <>
                        {/* ドライラン結果 */}
                        <div className="p-4 rounded-2xl bg-[#F0F4FF] border border-[#E9F0FF]">
                          <div className="text-[10px] font-black text-[#2A5CFF] uppercase tracking-widest mb-3">
                            実行するとこうなります
                          </div>
                          <ul className="text-xs text-[#1A1C1E] space-y-1.5 font-medium">
                            <li>新しく追加: <span className="font-black">{plan.toCreate.length}</span> 件</li>
                            <li>
                              既にある単語: <span className="font-black">{plan.duplicates.length}</span> 件
                              <span className="text-[#656E77]">
                                {strategy === "skip" && "（スキップ）"}
                                {strategy === "overwrite" && "（上書き）"}
                                {strategy === "duplicate" && "（別途追加）"}
                              </span>
                            </li>
                            {plan.invalid.length > 0 && (
                              <li className="text-orange-700">
                                取り込めない項目: {plan.invalid.length} 件
                              </li>
                            )}
                            {plan.skippedDecks > 0 && (
                              <li className="text-[#656E77]">
                                デッキ {plan.skippedDecks} 件は現在のバージョンでは復元されません
                              </li>
                            )}
                          </ul>
                        </div>

                        {/* 競合時の動作 */}
                        <div className="space-y-2">
                          <div className="text-[10px] font-bold text-[#656E77] uppercase tracking-widest">
                            既にある単語の扱い
                          </div>
                          {STRATEGY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => setStrategy(opt.value)}
                              disabled={busy}
                              className={`w-full text-left p-3 rounded-xl border transition-all ${
                                strategy === opt.value
                                  ? "border-[#2A5CFF] bg-[#F0F4FF]"
                                  : "border-[#E5E7EB] hover:bg-[#F1F3F5]"
                              }`}
                            >
                              <div className="text-xs font-bold text-[#1A1C1E]">{opt.label}</div>
                              <div className="text-[10px] text-[#656E77] mt-0.5">{opt.description}</div>
                            </button>
                          ))}
                        </div>

                        {strategy === "overwrite" && (
                          <div className="flex gap-2 p-3 rounded-xl bg-orange-50 border border-orange-100">
                            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-orange-800 leading-relaxed">
                              既存の単語の内容が置き換わります。実行前に現在のデータを
                              JSON で書き出しておくことをおすすめします。
                            </p>
                          </div>
                        )}

                        {progress && progress.total > 0 && (
                          <div className="h-1.5 bg-[#F1F3F5] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#2A5CFF] transition-all"
                              style={{ width: `${(progress.done / progress.total) * 100}%` }}
                            />
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            onClick={reset}
                            variant="outline"
                            disabled={busy}
                            className="flex-1 rounded-xl text-xs font-bold"
                          >
                            やめる
                          </Button>
                          <Button
                            onClick={handleApply}
                            disabled={busy || !willWrite}
                            className="flex-1 rounded-xl bg-[#2A5CFF] hover:bg-blue-700 text-xs font-bold"
                          >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "実行する"}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
