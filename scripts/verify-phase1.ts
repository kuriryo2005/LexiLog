/**
 * Phase 1 の検証。
 *
 * - partialJson の単体テスト（AI 呼び出しなし）
 * - 実際の Gemini ストリーミングを1回だけ実行し、部分結果の到達順を測る
 *
 *   npx tsx scripts/verify-phase1.ts          # 単体テストのみ
 *   npx tsx scripts/verify-phase1.ts --live   # 実 API も叩く（課金1回分）
 */
import { readFileSync } from "node:fs";
import { parsePartialJson } from "../api/_lib/partialJson.js";

// .env.local を読み込む（dotenv を挟まず最小限の実装）
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  // 無くても --live を付けなければ問題ない
}

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? ""); }
};

console.log("== parsePartialJson");

check("完成した JSON はそのまま", parsePartialJson('{"a":1,"b":"x"}')?.a === 1);
check("途中で切れた文字列値を捨てる", JSON.stringify(parsePartialJson('{"a":1,"b":"xy')) === '{"a":1}');
check("キーだけで値が無い場合を捨てる", JSON.stringify(parsePartialJson('{"a":1,"b":')) === '{"a":1}');
check("キーの途中を捨てる", JSON.stringify(parsePartialJson('{"a":1,"bcd')) === '{"a":1}');
check("末尾カンマを処理", JSON.stringify(parsePartialJson('{"a":1,')) === '{"a":1}');
check(
  "ネストしたオブジェクトを閉じる",
  JSON.stringify(parsePartialJson('{"a":{"b":2},"c')) === '{"a":{"b":2}}',
  JSON.stringify(parsePartialJson('{"a":{"b":2},"c'))
);
check(
  "配列を閉じる",
  JSON.stringify(parsePartialJson('{"xs":[1,2,3],"y')) === '{"xs":[1,2,3]}',
  JSON.stringify(parsePartialJson('{"xs":[1,2,3],"y'))
);
// 末尾のスカラーは確定していない（3 が 30 になるかもしれない）ので捨てる。
// 中途半端な値を一瞬だけ表示してしまうのを防ぐための意図的な挙動。
check(
  "末尾の未確定な数値を捨てる",
  JSON.stringify(parsePartialJson('{"xs":[1,2,3')) === '{"xs":[1,2]}',
  JSON.stringify(parsePartialJson('{"xs":[1,2,3'))
);
check(
  "外側の確定済みキーは保持する",
  JSON.stringify(parsePartialJson('{"word":"x","o":{"b":2')) === '{"word":"x"}',
  JSON.stringify(parsePartialJson('{"word":"x","o":{"b":2'))
);
check(
  "オブジェクト配列の未完成要素を捨てる",
  JSON.stringify(parsePartialJson('{"xs":[{"a":1},{"a"')) === '{"xs":[{"a":1}]}',
  JSON.stringify(parsePartialJson('{"xs":[{"a":1},{"a"'))
);
check(
  "エスケープを含む文字列",
  parsePartialJson('{"a":"say \\"hi\\"","b":2')?.a === 'say "hi"'
);
check("日本語を含む文字列", parsePartialJson('{"m":"乱気流","n":')?.m === "乱気流");
check("数値の途中を捨てる", JSON.stringify(parsePartialJson('{"a":1,"b":12')) === '{"a":1}');
check("何も取り出せない場合は null", parsePartialJson('{"a') === null);
check("空文字は null", parsePartialJson("") === null);

console.log(`\n${pass} passed, ${fail} failed`);

if (!process.argv.includes("--live")) {
  console.log("\n(--live を付けると実際の Gemini ストリーミングも検証します)");
  process.exit(fail === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- live test
console.log("\n== 実 API でのストリーミング検証");

const { getClient, MODEL, WORD_SCHEMA, FAST_THINKING, buildLookupPrompt } =
  await import("../api/_lib/gemini.js");

const t0 = Date.now();
const stream = await getClient().models.generateContentStream({
  model: MODEL,
  contents: buildLookupPrompt("resilience", "gen"),
  config: {
    responseMimeType: "application/json",
    responseSchema: WORD_SCHEMA,
    thinkingConfig: FAST_THINKING,
  },
});

let buffer = "";
const firstSeenAt = new Map<string, number>();
let firstChunkAt = 0;

for await (const chunk of stream) {
  if (!chunk.text) continue;
  if (!firstChunkAt) firstChunkAt = Date.now() - t0;
  buffer += chunk.text;
  const partial = parsePartialJson(buffer);
  if (!partial) continue;
  for (const key of Object.keys(partial)) {
    if (!firstSeenAt.has(key)) firstSeenAt.set(key, Date.now() - t0);
  }
}

const total = Date.now() - t0;
const final = JSON.parse(buffer);

console.log(`  最初のチャンク : ${(firstChunkAt / 1000).toFixed(1)}s`);
console.log(`  全体の完了     : ${(total / 1000).toFixed(1)}s`);
console.log("\n  各項目が確定した時刻:");
for (const [key, ms] of firstSeenAt) {
  console.log(`    ${key.padEnd(22)} ${(ms / 1000).toFixed(1)}s`);
}

console.log("\n  必須項目の充足:");
for (const key of WORD_SCHEMA.required) {
  const v = (final as Record<string, unknown>)[key];
  const ok = v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0);
  check(`    ${key}`, ok, v);
}
console.log(`\n  phonetic: ${final.phonetic}`);
console.log(`  meaning : ${final.meaning}`);

const meaningAt = firstSeenAt.get("meaning");
console.log(
  `\n体感の改善: 全体 ${(total / 1000).toFixed(1)}s に対し、` +
    `意味は ${meaningAt ? (meaningAt / 1000).toFixed(1) : "?"}s で表示できる`
);

process.exit(fail === 0 ? 0 : 1);
