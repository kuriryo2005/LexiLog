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
            className="absolute inset-0 bg-black/30"
          />
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            className="relative w-full max-w-lg"
          >
            <div className="w-full max-h-[85vh] overflow-y-auto bg-white">
              {/* Header */}
              <div className="flex items-center justify-between px-8 pt-8 pb-6 sticky top-0 bg-white">
                <h2 className="text-lg font-black tracking-tight">データの書き出し / 復元</h2>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy}
                  className="w-8 h-8 flex items-center justify-center text-[#8A9199] hover:text-[#1A1C1E]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-6 px-8 border-b border-[#EAECEF]">
                <button
                  onClick={() => { setTab("export"); reset(); }}
                  disabled={busy}
                  className={`flex items-center gap-2 pb-3 text-xs font-bold border-b-2 -mb-px transition-colors ${
                    tab === "export"
                      ? "text-[#1A1C1E] border-[#1A1C1E]"
                      : "text-[#8A9199] border-transparent hover:text-[#1A1C1E]"
                  }`}
                >
                  <Download className="w-4 h-4" />
                  書き出し
                </button>
                <button
                  onClick={() => { setTab("import"); reset(); }}
                  disabled={busy}
                  className={`flex items-center gap-2 pb-3 text-xs font-bold border-b-2 -mb-px transition-colors ${
                    tab === "import"
                      ? "text-[#1A1C1E] border-[#1A1C1E]"
                      : "text-[#8A9199] border-transparent hover:text-[#1A1C1E]"
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  復元
                </button>
              </div>

              <div className="px-8 py-6">
                {tab === "export" ? (
                  <div>
                    <p className="text-xs text-[#656E77] leading-loose mb-6">
                      保存済みの <span className="font-bold text-[#1A1C1E]">{wordCount}</span> 件を書き出します。
                      絞り込み中でも常に全件が対象です。
                    </p>
                    {EXPORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.format}
                        onClick={() => handleExport(opt.format)}
                        disabled={busy}
                        className="w-full text-left py-4 border-t border-[#EAECEF] disabled:opacity-40 flex items-start gap-4 group"
                      >
                        <span className="text-[#8A9199] group-hover:text-[#2A5CFF] shrink-0 mt-0.5 transition-colors">
                          {opt.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-[#1A1C1E] group-hover:text-[#2A5CFF] transition-colors">
                            {opt.label}
                          </span>
                          <span className="block text-[11px] text-[#8A9199] mt-0.5 leading-relaxed">
                            {opt.description}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    {/* 結果表示 */}
                    {result ? (
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          <span className="text-sm font-black text-[#1A1C1E]">復元が完了しました</span>
                        </div>
                        <ul className="text-xs text-[#656E77] space-y-1.5 leading-relaxed mb-8">
                          <li>追加: {result.created} 件</li>
                          {result.overwritten > 0 && <li>上書き: {result.overwritten} 件</li>}
                          {result.skipped > 0 && <li>スキップ（既存）: {result.skipped} 件</li>}
                          {result.invalid > 0 && <li>取り込めなかった項目: {result.invalid} 件</li>}
                        </ul>
                        <button type="button" onClick={reset} className="btn-quiet px-0 text-sm">
                          別のファイルを読み込む
                        </button>
                      </div>
                    ) : !plan ? (
                      <>
                        <p className="text-xs text-[#656E77] leading-loose mb-6">
                          書き出した JSON ファイルを選ぶと、何件追加されるかを先に表示します。
                          確認してから実行できます。
                        </p>
                        <input
                          ref={fileRef}
                          type="file"
                          accept="application/json,.json"
                          onChange={handleFileSelected}
                          disabled={busy}
                          className="block w-full text-xs text-[#656E77] file:mr-4 file:py-2 file:px-4 file:rounded-none file:border-0 file:text-xs file:font-bold file:bg-[#1A1C1E] file:text-white file:cursor-pointer cursor-pointer"
                        />
                      </>
                    ) : (
                      <>
                        {/* ドライラン結果 */}
                        <div className="mb-8">
                          <div className="section-label">実行するとこうなります</div>
                          <ul className="text-xs text-[#1A1C1E] space-y-2 leading-relaxed">
                            <li>新しく追加: <span className="font-black">{plan.toCreate.length}</span> 件</li>
                            <li>
                              既にある単語: <span className="font-black">{plan.duplicates.length}</span> 件
                              <span className="text-[#8A9199]">
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
                              <li className="text-[#8A9199]">
                                デッキ {plan.skippedDecks} 件は現在のバージョンでは復元されません
                              </li>
                            )}
                          </ul>
                        </div>

                        {/* 競合時の動作 */}
                        <div className="mb-8">
                          <div className="section-label">既にある単語の扱い</div>
                          {STRATEGY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => setStrategy(opt.value)}
                              disabled={busy}
                              className="w-full text-left py-3 border-t border-[#F1F3F5] flex items-start gap-3"
                            >
                              <span
                                className={`w-3.5 h-3.5 mt-0.5 shrink-0 rounded-full border-2 ${
                                  strategy === opt.value
                                    ? "border-[#1A1C1E] bg-[#1A1C1E]"
                                    : "border-[#C9CDD2]"
                                }`}
                              />
                              <span>
                                <span
                                  className={`block text-xs font-bold ${
                                    strategy === opt.value ? "text-[#1A1C1E]" : "text-[#656E77]"
                                  }`}
                                >
                                  {opt.label}
                                </span>
                                <span className="block text-[10px] text-[#8A9199] mt-0.5">
                                  {opt.description}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>

                        {strategy === "overwrite" && (
                          <p className="flex gap-2 mb-8 pl-4 border-l-2 border-orange-400 text-[11px] text-[#656E77] leading-loose">
                            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                            既存の単語の内容が置き換わります。実行前に現在のデータを
                            JSON で書き出しておくことをおすすめします。
                          </p>
                        )}

                        {progress && progress.total > 0 && (
                          <div className="h-0.5 bg-[#F1F3F5] mb-8">
                            <div
                              className="h-0.5 bg-[#1A1C1E] transition-all"
                              style={{ width: `${(progress.done / progress.total) * 100}%` }}
                            />
                          </div>
                        )}

                        <div className="flex items-center gap-8">
                          <button
                            type="button"
                            onClick={handleApply}
                            disabled={busy || !willWrite}
                            className="btn-primary"
                          >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "実行する"}
                          </button>
                          <button
                            type="button"
                            onClick={reset}
                            disabled={busy}
                            className="text-sm font-bold text-[#8A9199] hover:text-[#1A1C1E] disabled:opacity-30"
                          >
                            やめる
                          </button>
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
