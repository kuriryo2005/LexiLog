/**
 * 実際に書き出したバックアップファイルを検証し、
 * 復元タブに表示されるはずの件数を先に計算する。
 * Firestore には一切アクセスしない。
 *
 *   npx tsx scripts/inspect-backup.ts <path-to-json>
 */
import { readFileSync } from "node:fs";
import { parseBundle, buildPlan } from "../src/lib/importData";

const path = process.argv[2];
if (!path) {
  console.error("使い方: npx tsx scripts/inspect-backup.ts <path-to-json>");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
const raw = JSON.parse(text);
const parsed = parseBundle(text);
const words = parsed.words;

console.log("== ファイル");
console.log(`  app            : ${raw.app}`);
console.log(`  formatVersion  : ${raw.formatVersion}`);
console.log(`  exportedAt     : ${new Date(raw.exportedAt).toLocaleString("ja-JP")}`);
console.log(`  counts.words   : ${raw.counts?.words}`);
console.log(`  words.length   : ${words.length}`);
console.log(`  一致           : ${raw.counts?.words === words.length ? "OK" : "不一致"}`);

console.log("\n== 中身");
const modes = new Map<string, number>();
const versions = new Map<string, number>();
let withReview = 0;
let withNextReview = 0;
let missingCore = 0;
let times: number[] = [];

for (const w of words) {
  modes.set(String(w.mode ?? "(なし)"), (modes.get(String(w.mode ?? "(なし)")) ?? 0) + 1);
  const v = String(w.schemaVersion ?? 1);
  versions.set(v, (versions.get(v) ?? 0) + 1);
  if (Array.isArray(w.reviewHistory) && w.reviewHistory.length > 0) withReview++;
  if (typeof w.nextReviewAt === "number") withNextReview++;
  if (!w.word || !w.meaning) missingCore++;
  if (typeof w.timestamp === "number") times.push(w.timestamp);
}

console.log(`  モード内訳     : ${[...modes].map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`  schemaVersion  : ${[...versions].map(([k, v]) => `v${k}=${v}`).join(", ")}`);
console.log(`  復習履歴あり   : ${withReview} 件`);
console.log(`  次回復習日あり : ${withNextReview} 件`);
console.log(`  word/meaning 欠落 : ${missingCore} 件`);
times.sort((a, b) => a - b);
if (times.length) {
  console.log(`  保存日の範囲   : ${new Date(times[0]).toLocaleDateString("ja-JP")} 〜 ${new Date(times[times.length - 1]).toLocaleDateString("ja-JP")}`);
}

console.log("\n== 単語（先頭10件）");
for (const w of words.slice(0, 10)) {
  console.log(`  ${String(w.word).padEnd(20)} ${String(w.meaning).slice(0, 28)}`);
}

console.log("\n== 復元タブに出るはずの数字（このファイルを自分に取り込む場合）");
const uid = String(raw.uid);
// 既存データ = このバックアップの中身そのもの（id 付き）
const existing = words.map((w, i) => ({ ...w, id: String(w.id ?? `doc${i}`) }));
const plan = buildPlan({ words, decks: parsed.decks, exportedAt: parsed.exportedAt }, existing, uid);
console.log(`  新しく追加     : ${plan.toCreate.length} 件   ← 0 が正解`);
console.log(`  既にある単語   : ${plan.duplicates.length} 件   ← 単語数と一致するのが正解`);
console.log(`  取り込めない   : ${plan.invalid.length} 件`);
if (plan.invalid.length) {
  for (const iv of plan.invalid.slice(0, 10)) console.log(`      - ${iv.word}: ${iv.reason}`);
}

const ok = plan.toCreate.length === 0 && plan.duplicates.length + plan.invalid.length === words.length;
console.log(`\n判定: ${ok ? "OK — 重複判定は正しく動く" : "要確認"}`);
