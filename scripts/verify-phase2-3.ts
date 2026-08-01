/**
 * Phase 2 / 3 の純粋ロジックの検証（実装仕様書 F2 / F3 / F4）。
 *
 *   npx tsx scripts/verify-phase2-3.ts
 *
 * Firestore にも Gemini にも接続しない。ネットワークを使わずに回せる範囲だけを
 * 対象にしている（React コンポーネントと onSnapshot は手動確認）。
 */

import { normalizeWord, normalizeExamples } from "../src/lib/normalize.js";
import { buildQueue } from "../src/hooks/useReviewSession.js";
import { formatPhonetic } from "../src/lib/tts.js";
import { DictionaryMode, ReviewRating, SavedWord } from "../src/types.js";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail === undefined ? "" : `  → ${JSON.stringify(detail)}`}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

function word(id: string, extra: Partial<SavedWord> = {}): SavedWord {
  return normalizeWord(id, {
    word: id,
    meaning: `${id} の意味`,
    grammar: "noun",
    timestamp: now,
    ...extra,
  });
}

// ---------------------------------------------------------------- normalizeWord

section("normalizeWord — v1 のデータを壊さずに v2 の形へ揃える");
{
  // 実際の43件と同じ形（schemaVersion も mode も tags も無い）
  const v1 = normalizeWord("abc", {
    word: "Resilience",
    meaning: "回復力",
    grammar: "noun",
    timestamp: 1700000000000,
    examples: ["The bridge showed resilience.\nその橋は回復力を示した。"],
  });

  check("schemaVersion が 1 で補われる", v1.schemaVersion === 1, v1.schemaVersion);
  check("wordLower が小文字で生成される", v1.wordLower === "resilience", v1.wordLower);
  check("tags が空配列になる", Array.isArray(v1.tags) && v1.tags.length === 0);
  check("deckId が null になる", v1.deckId === null);
  check("phonetic は無いままで undefined", v1.phonetic === undefined);
  check("id が付く", v1.id === "abc");
  check("元の word は書き換えない", v1.word === "Resilience");
  check("examples は元の文字列配列のまま", v1.examples[0].includes("\n"));
  check("examplePairs に分解される", v1.examplePairs?.[0].en === "The bridge showed resilience.");
  check("examplePairs の和訳", v1.examplePairs?.[0].ja === "その橋は回復力を示した。");
  check("importanceScore の既定は 0.5", v1.importanceScore === 0.5);

  // 配列であるべき項目が欠けていても落ちない（部分的に壊れたデータへの耐性）
  const broken = normalizeWord("x", { word: "w", synonyms: "not-an-array", examples: null });
  check("配列でない synonyms は空配列に落とす", Array.isArray(broken.synonyms) && broken.synonyms.length === 0);
  check("examples が null でも空配列", Array.isArray(broken.examples) && broken.examples.length === 0);

  // v2 の値は尊重する
  const v2 = normalizeWord("y", {
    word: "w",
    schemaVersion: 2,
    wordLower: "custom",
    phonetic: "ˈtɜːbjələns",
    tags: ["ielts"],
  });
  check("既存の schemaVersion を上書きしない", v2.schemaVersion === 2);
  check("既存の wordLower を上書きしない", v2.wordLower === "custom");
  check("phonetic を保持する", v2.phonetic === "ˈtɜːbjələns");
  check("tags を保持する", v2.tags?.[0] === "ielts");
}

section("normalizeExamples — 文字列とオブジェクトの両方を受ける");
{
  check("改行区切りの文字列", normalizeExamples(["A.\nあ。"])[0].ja === "あ。");
  check("和訳が無い場合は空文字", normalizeExamples(["A."])[0].ja === "");
  check("オブジェクト形式", normalizeExamples([{ en: "A", ja: "あ" }])[0].en === "A");
  check("配列でなければ空", normalizeExamples(null).length === 0);
}

// ------------------------------------------------------------------- buildQueue

section("buildQueue — 復習キューの構築（F3）");
{
  const overdue = word("overdue", { nextReviewAt: todayStart - 3 * DAY });
  const overdue2 = word("overdue2", { nextReviewAt: todayStart - 10 * DAY });
  const dueToday = word("today", { nextReviewAt: now + 60 * 1000 });
  const fresh = word("fresh");
  const future = word("future", { nextReviewAt: now + 7 * DAY });

  const all = [fresh, future, dueToday, overdue, overdue2];

  const due = buildQueue(all, { onlyDue: true });
  check("onlyDue で未来の予定は除外される", !due.includes("future"), due);
  check("onlyDue でも未復習は含まれる", due.includes("fresh"), due);
  check("期限超過が先頭", due[0] === "overdue2", due);
  check("放置が長い順に並ぶ", due.indexOf("overdue2") < due.indexOf("overdue"), due);
  check("未復習は末尾側", due.indexOf("fresh") > due.indexOf("today"), due);

  const allQueue = buildQueue(all, { onlyDue: false });
  check("onlyDue=false なら全件入る", allQueue.length === 5, allQueue);

  const academic = word("aca", { mode: DictionaryMode.ACADEMIC });
  const general = word("gen", { mode: DictionaryMode.GENERAL });
  const filtered = buildQueue([academic, general], { onlyDue: false, mode: DictionaryMode.ACADEMIC });
  check("mode で絞り込める", filtered.length === 1 && filtered[0] === "aca", filtered);

  check("0件でも落ちない", buildQueue([], { onlyDue: true }).length === 0);

  // 上限200枚
  const many = Array.from({ length: 250 }, (_, i) => word(`w${i}`));
  check("上限200枚で打ち切る", buildQueue(many, { onlyDue: false }).length === 200);

  // ID の重複が無いこと（同じカードが2回出ないことの根拠）
  const q = buildQueue(many, { onlyDue: false });
  check("キューに重複IDが無い", new Set(q).size === q.length);

  // シャッフルされていること（毎回同じ順序で覚えてしまうのを防ぐ）
  const a = buildQueue(many, { onlyDue: false }).join(",");
  const b = buildQueue(many, { onlyDue: false }).join(",");
  check("同順位内はシャッフルされる", a !== b);
}

section("buildQueue — 並び順は onSnapshot の入力順に依存しない");
{
  const base = [
    word("a", { nextReviewAt: todayStart - DAY }),
    word("b", { nextReviewAt: todayStart - 2 * DAY }),
  ];
  const forward = buildQueue(base, { onlyDue: true });
  const reversed = buildQueue([...base].reverse(), { onlyDue: true });
  check("入力順を変えても期限超過の順序は同じ", forward.join() === reversed.join(), {
    forward,
    reversed,
  });
}

// ------------------------------------------------------------------ formatPhonetic

section("formatPhonetic — 表示用の整形（F4）");
{
  check("スラッシュで囲む", formatPhonetic("ˈtɜːbjələns") === "/ˈtɜːbjələns/");
  check("既にスラッシュがあれば二重にしない", formatPhonetic("/ˈtɜːbjələns/") === "/ˈtɜːbjələns/");
  check("空なら null", formatPhonetic("") === null);
  check("undefined なら null", formatPhonetic(undefined) === null);
  check("空白のみなら null", formatPhonetic("   ") === null);
}

// ------------------------------------------------------------------ 集計の健全性

section("ReviewRating — 数値キーの前提（キーボードの 1〜4 と対応）");
{
  check("AGAIN === 1", ReviewRating.AGAIN === 1);
  check("HARD === 2", ReviewRating.HARD === 2);
  check("GOOD === 3", ReviewRating.GOOD === 3);
  check("EASY === 4", ReviewRating.EASY === 4);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
