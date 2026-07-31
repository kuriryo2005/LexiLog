/**
 * Phase 0（データの書き出し / 復元）の純粋ロジック検証。
 * Firestore にはアクセスしないので、本番データに影響しない。
 *
 *   npx tsx scripts/verify-phase0.ts
 */
import { normalizeExamples, toWordLower, toModeSlug } from "../src/lib/normalize";
import { toCsvBlob, toAnkiBlob, exportFileName, type ExportBundle } from "../src/lib/exportData";
import { parseBundle, buildPlan, ImportValidationError } from "../src/lib/importData";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

function section(s: string) {
  console.log(`\n== ${s}`);
}

const UID = "user-abc";

function bundle(words: Record<string, unknown>[]): ExportBundle {
  return {
    app: "cortex-dictionary",
    formatVersion: 1,
    exportedAt: 1780000000000,
    uid: UID,
    counts: { words: words.length, decks: 0 },
    decks: [],
    words,
  };
}

/** 既存の v1 データを模した単語。 */
const v1Word: Record<string, unknown> = {
  id: "doc1",
  word: "turbulence",
  meaning: "乱気流、動乱",
  grammar: "noun",
  category: "Mechanical Engineering",
  etymology: "ラテン語 turbulentus に由来",
  nuance: "混乱した状態を指す",
  specializedContexts: [{ field: "Engineering", context: "流れの乱れ" }],
  examples: ["The plane hit turbulence.\n飛行機が乱気流に入った。"],
  synonyms: [{ word: "upheaval", translation: "動乱" }],
  antonyms: [{ word: "calm", translation: "平穏" }],
  etymologyNodes: [],
  mode: "一般",
  userId: "someone-else",
  timestamp: 1770000000000,
  reviewHistory: [{ rating: 3, timestamp: 1775000000000 }],
  nextReviewAt: 1790000000000,
};

async function main() {
  section("normalize");
  check(
    "英文と和訳を分解する",
    JSON.stringify(normalizeExamples(["A cat sat.\n猫が座った。"])) ===
      JSON.stringify([{ en: "A cat sat.", ja: "猫が座った。" }])
  );
  check("和訳が無くても落ちない", normalizeExamples(["Only English"])[0].ja === "");
  check("オブジェクト形式も受け付ける", normalizeExamples([{ en: "x", ja: "y" }])[0].en === "x");
  check("配列以外は空配列", normalizeExamples(null).length === 0 && normalizeExamples("s").length === 0);
  check("toWordLower", toWordLower("  TurBulence ") === "turbulence");
  check(
    "toModeSlug",
    toModeSlug("学術（Academic）") === "aca" && toModeSlug("一般") === "gen" && toModeSlug(undefined) === "gen"
  );

  section("CSV");
  const csvBlob = toCsvBlob(bundle([v1Word]));
  const csv = await csvBlob.text();
  // Blob.text() は仕様上 BOM を取り除いて復号するため、生のバイト列で確認する
  const csvBytes = new Uint8Array(await csvBlob.arrayBuffer());
  check(
    "UTF-8 BOM (EF BB BF) で始まる",
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    Array.from(csvBytes.slice(0, 3))
  );
  check("ヘッダ行がある", csv.split("\r\n")[0].startsWith("word,phonetic,meaning"));
  check(
    "例文が en / ja に分かれる",
    csv.includes("The plane hit turbulence.") && csv.includes("飛行機が乱気流に入った。")
  );
  check("類義語が訳つきで結合される", csv.includes("upheaval (動乱)"));

  const nasty = await toCsvBlob(
    bundle([{ ...v1Word, meaning: 'カンマ, と "引用符"', nuance: "改行\nあり" }])
  ).text();
  check("カンマと引用符をエスケープする", nasty.includes('"カンマ, と ""引用符"""'));
  check("改行を含むセルを引用する", nasty.includes('"改行\nあり"'));

  section("Anki TSV");
  const anki = await toAnkiBlob(
    bundle([{ ...v1Word, phonetic: "ˈtɜːbjələns", tags: ["要暗記", "論文 頻出"] }])
  ).text();
  const cols = anki.replace(/^﻿/, "").split("\t");
  check("3列である", cols.length === 3, cols.length);
  check("表面に発音記号が入る", cols[0].includes("/ˈtɜːbjələns/"));
  check("裏面に意味が入る", cols[1].includes("乱気流"));
  check("タグ内の空白が _ に置換される", cols[2] === "要暗記 論文_頻出", cols[2]);
  check("フィールドに生の改行が残らない", !cols[1].includes("\n"));

  section("ファイル名");
  const d = new Date(2026, 7, 1);
  check("json", exportFileName("json", d) === "cortex-dictionary_2026-08-01.json");
  check("anki", exportFileName("anki", d) === "cortex-dictionary_2026-08-01_anki.tsv");

  section("parseBundle の入力検証");
  const mustThrow = (label: string, text: string) => {
    try {
      parseBundle(text);
      check(label, false, "例外が出なかった");
    } catch (e) {
      check(label, e instanceof ImportValidationError, e);
    }
  };
  mustThrow("壊れた JSON を弾く", "{not json");
  mustThrow("別アプリのファイルを弾く", JSON.stringify({ app: "other", formatVersion: 1, words: [] }));
  mustThrow("未来のバージョンを弾く", JSON.stringify({ app: "cortex-dictionary", formatVersion: 99, words: [] }));
  mustThrow("words が配列でない場合を弾く", JSON.stringify({ app: "cortex-dictionary", formatVersion: 1, words: {} }));
  check("正しいファイルは通る", parseBundle(JSON.stringify(bundle([v1Word]))).words.length === 1);

  section("buildPlan（ドライラン判定）");
  const p1 = buildPlan(bundle([v1Word]), [], UID);
  check("空の状態なら新規1件", p1.toCreate.length === 1 && p1.duplicates.length === 0);
  check("userId が自分に差し替わる", p1.toCreate[0].userId === UID);
  check("timestamp は元の値を保持する", p1.toCreate[0].timestamp === 1770000000000);
  check("wordLower が付与される", p1.toCreate[0].wordLower === "turbulence");
  check("schemaVersion 2 が付与される", p1.toCreate[0].schemaVersion === 2);
  check("id をフィールドとして持ち込まない", !("id" in p1.toCreate[0]));

  const p2 = buildPlan(bundle([v1Word]), [{ ...v1Word, id: "existing1", userId: UID }], UID);
  check("同じ単語 + 同じモードは重複扱い", p2.duplicates.length === 1 && p2.toCreate.length === 0);
  check("既存ドキュメントの id を参照する", p2.duplicates[0].existingId === "existing1");

  const p3 = buildPlan(
    bundle([{ ...v1Word, mode: "学術（Academic）" }]),
    [{ ...v1Word, id: "e1", userId: UID }],
    UID
  );
  check("モードが違えば別の単語として扱う", p3.toCreate.length === 1 && p3.duplicates.length === 0);

  const p4 = buildPlan(bundle([v1Word, { ...v1Word, word: "TURBULENCE" }]), [], UID);
  check("大小文字違いはファイル内重複として1件に畳む", p4.toCreate.length === 1 && p4.invalid.length === 1);

  const p5 = buildPlan(
    bundle([{ word: "", meaning: "x" }, { word: "y", meaning: "" }, { word: "z", meaning: "ok" }]),
    [],
    UID
  );
  check("word / meaning が空のものを弾く", p5.invalid.length === 2 && p5.toCreate.length === 1);

  section("セキュリティルールの上限を守る");
  const big = buildPlan(
    bundle([
      {
        ...v1Word,
        grammar: "g".repeat(300),
        meaning: "m".repeat(5000),
        examples: new Array(50).fill("a\nb"),
        specializedContexts: new Array(50).fill({ field: "f", context: "c" }),
        synonyms: new Array(50).fill({ word: "w", translation: "t" }),
        reviewHistory: new Array(5000).fill({ rating: 3, timestamp: 1 }),
      },
    ]),
    [],
    UID
  );
  const w = big.toCreate[0];
  check("grammar <= 100", String(w.grammar).length === 100);
  check("meaning <= 1000", String(w.meaning).length === 1000);
  check("examples <= 10", (w.examples as unknown[]).length === 10);
  check("specializedContexts <= 5", (w.specializedContexts as unknown[]).length === 5);
  check("synonyms <= 10", (w.synonyms as unknown[]).length === 10);
  check("reviewHistory <= 1000", (w.reviewHistory as unknown[]).length === 1000);

  const badMode = buildPlan(bundle([{ ...v1Word, mode: "HACKER" }]), [], UID);
  check("不正な mode は 一般 に矯正する", badMode.toCreate[0].mode === "一般");
  check("undefined が混入しない", !JSON.stringify(badMode.toCreate[0]).includes("undefined"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
