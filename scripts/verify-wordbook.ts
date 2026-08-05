/**
 * 単語帳（紙面）の純粋ロジックの検証。
 *
 *   npx tsx scripts/verify-wordbook.ts
 *
 * 和訳の色付け範囲は推定なので、写真の紙面と同じ結果になる例を
 * ここに固定しておく。ヒューリスティクスを触ったときに気付けるようにする。
 */

import {
  REVIEW_DAYS,
  WORDS_PER_UNIT,
  WORD_CHECK_SLOTS,
  buildUnits,
  findJaSpan,
  posBadge,
  reviewDate,
  splitByTarget,
  meaningSource,
  splitJaByMeaning,
  splitParticle,
  splitPrimarySense,
  splitSenses,
  toggleCheck,
} from "../src/lib/wordbook.js";
import {
  TARGET_SCHEMA_VERSION,
  normalizeDerivatives,
  normalizeSenses,
  normalizeTargetPhrases,
  normalizeWord,
} from "../src/lib/normalize.js";
import { lacksExampleJa, needsBackfill } from "../src/hooks/useTargetBackfill.js";
import { SavedWord } from "../src/types.js";

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
const base = Date.UTC(2026, 0, 1);

function word(id: string, timestamp: number, extra: Partial<SavedWord> = {}): SavedWord {
  return normalizeWord(id, { word: id, meaning: "意味", timestamp, ...extra });
}

/** 色が付いた部分だけを取り出す。 */
function hits(parts: { text: string; hit: boolean }[]): string[] {
  return parts.filter((p) => p.hit).map((p) => p.text);
}

section("buildUnits");
{
  const words = Array.from({ length: 43 }, (_, i) => word(`w${i}`, base + i * DAY));
  const units = buildUnits(words);

  check("43語は7語ずつで7ユニット", units.length === 7, units.length);
  check("最終ユニットは1語", units[6].words.length === 1, units[6].words.length);
  check("通し番号は0埋め2桁", units[0].label === "01" && units[6].label === "07");
  check("通算語数が積み上がる", units[0].cumulative === 7 && units[6].cumulative === 43);
  check("語の範囲が連続する", units[1].from === 8 && units[1].to === 14);

  // 並び順が入力に依存しないこと。紙に印刷した後で崩れると意味がない
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const again = buildUnits(shuffled);
  check(
    "入力順を変えても同じ構成になる",
    again.map((u) => u.unitId).join() === units.map((u) => u.unitId).join()
  );

  // 末尾に語を足しても既存ユニットの鍵が変わらないこと（チェック印が生き残る条件）
  const extended = buildUnits([...words, word("new", base + 100 * DAY)]);
  check(
    "末尾に足しても既存ユニットの unitId は不変",
    extended.slice(0, 6).every((u, i) => u.unitId === units[i].unitId)
  );

  check("空でも落ちない", buildUnits([]).length === 0);
  check("1ユニットの語数は定数どおり", WORDS_PER_UNIT === 7);
}

section("復習チェック");
{
  const empty = {};
  const one = toggleCheck(empty, "u1", 1);
  check("チェックを付ける", one.u1.join() === "1");

  const two = toggleCheck(one, "u1", 7);
  check("複数付けると昇順に並ぶ", two.u1.join() === "1,7", two.u1);

  const off = toggleCheck(two, "u1", 1);
  check("同じ日を押すと外れる", off.u1.join() === "7", off.u1);

  check("元のオブジェクトを壊さない", Object.keys(empty).length === 0);
  check("復習日は4段階", REVIEW_DAYS.length === 4 && REVIEW_DAYS[3] === 21);

  const d = reviewDate(Date.UTC(2026, 0, 1), 3);
  check("Day3 は3日後", d.getDate() === 4 || d.getDate() === 3, d.toISOString());
}

section("品詞バッジ");
{
  check("動詞", posBadge("動詞") === "動");
  check("verb", posBadge("verb") === "動");
  check("名詞", posBadge("名詞") === "名");
  check("形容詞", posBadge("adjective") === "形");
  check("空なら語", posBadge("") === "語");
}

section("語義の分割");
{
  check("；で分ける", splitSenses("を変える；変わる；を替える").length === 3);
  check("区切りが無ければ1つ", splitSenses("を必要とする").length === 1);
  check("空なら0件", splitSenses("").length === 0);
}

section("英文中の見出し語");
{
  const cases: [string, string, string][] = [
    ["change", "This book changed my life.", "changed"],
    ["learn", "I learned a lot from my teachers.", "learned"],
    ["help", "She helped me with my homework.", "helped"],
    ["need", "He needs to practice harder.", "needs"],
    ["live", "They have lived in this town since this April.", "lived"],
    ["ask", "I'll ask her to help us.", "ask"],
    ["enjoy", "He enjoyed himself at the party.", "enjoyed"],
    ["study", "She studied all night.", "studied"],
  ];

  for (const [w, sentence, expected] of cases) {
    const got = hits(splitByTarget(sentence, w));
    check(`${w} → ${expected}`, got[0] === expected, got);
  }

  check(
    "部分一致では拾わない",
    hits(splitByTarget("He changed the unchanged part.", "change")).length === 1
  );
  check("該当が無ければ色を付けない", hits(splitByTarget("Nothing here.", "change")).length === 0);
  check("空文でも落ちない", splitByTarget("", "change").length === 1);
}

section("和訳の対応部分");
{
  // 写真の紙面と同じ範囲になること
  const cases: [string, string, string][] = [
    ["を変える；変わる", "この本は私の人生を変えた。", "変えた"],
    ["を学ぶ；を覚える", "私は先生たちから多くのことを学んだ。", "学んだ"],
    ["(人)を手伝う，助ける", "彼女は私の宿題を手伝ってくれた。", "手伝って"],
    ["を必要とする", "彼はもっと熱心に練習する必要がある。", "必要がある"],
    ["住んでいる，生きる；暮らす", "彼らは今年の4月からこの町に住んでいる。", "住んでいる"],
    ["を頼む；に尋ねる", "彼女に私たちを手伝ってくれるよう頼むことにするよ。", "頼む"],
    ["を楽しむ", "彼はパーティーで楽しく過ごした。", "楽しく"],
  ];

  for (const [meaning, ja, expected] of cases) {
    const got = hits(splitJaByMeaning(ja, meaning));
    check(`${meaning.slice(0, 8)} → ${expected}`, got[0] === expected, got);
  }

  // v3 の語義（AI が返す長めの言い回し）でも対応が取れること
  const v3 = normalizeWord("v3", {
    word: "change",
    meaning: "を変える；変わる；を替える",
    senses: [{ ja: "(物・事)を変える，変更する" }, { ja: "(状況)が変わる" }],
    schemaVersion: TARGET_SCHEMA_VERSION,
    timestamp: base,
  });
  check(
    "語義から色付けの範囲を取る",
    hits(splitJaByMeaning("私たちは旅行の計画を変更する必要がある。", meaningSource(v3)))[0] ===
      "変更する",
    hits(splitJaByMeaning("私たちは旅行の計画を変更する必要がある。", meaningSource(v3)))
  );
  check(
    "senses が無ければ meaning を使う",
    meaningSource(normalizeWord("x", { word: "w", meaning: "を変える", timestamp: base })) ===
      "を変える"
  );

  check("対応が無ければ色を付けない", findJaSpan("まったく無関係な文です。", "を変える") === null);
  check("和訳が空でも落ちない", findJaSpan("", "を変える") === null);
  check(
    "色を付けても本文は欠けない",
    splitJaByMeaning("この本は私の人生を変えた。", "を変える")
      .map((p) => p.text)
      .join("") === "この本は私の人生を変えた。"
  );
}

section("語義の正規化（v3 と旧データの橋渡し）");
{
  const fromAi = normalizeSenses(
    [{ ja: "(人)を手伝う，助ける" }, { ja: "(人)に役立つ" }],
    "無視される"
  );
  check("AI の senses をそのまま使う", fromAi.length === 2 && fromAi[0].ja === "(人)を手伝う，助ける");

  const fromMeaning = normalizeSenses(undefined, "を変える；変わる；を替える");
  check("senses が無ければ meaning から作る", fromMeaning.length === 3, fromMeaning);
  check("① にあたる語義が先頭", fromMeaning[0].ja === "を変える");

  check("空配列なら meaning にフォールバック", normalizeSenses([], "を学ぶ").length === 1);
  check("どちらも空なら0件", normalizeSenses(undefined, "").length === 0);
}

section("ターゲットフレーズの正規化");
{
  const fromAi = normalizeTargetPhrases(
    [{ en: "help A with B", ja: "AのBを手伝う" }],
    ["無視される"]
  );
  check("AI の targetPhrases を使う", fromAi[0].en === "help A with B" && fromAi[0].ja === "AのBを手伝う");

  const fromColloc = normalizeTargetPhrases(undefined, [
    "change one's life「〜の人生を変える」",
    "change trains「乗り換える」",
  ]);
  check("collocations から型と訳に割る", fromColloc.length === 2, fromColloc);
  check("英語側だけ取り出す", fromColloc[0].en === "change one's life", fromColloc[0].en);
  check("訳から鉤括弧を外す", fromColloc[0].ja === "〜の人生を変える", fromColloc[0].ja);

  const noGloss = normalizeTargetPhrases(undefined, ["make a decision"]);
  check("訳が無くても型として残す", noGloss[0].en === "make a decision" && noGloss[0].ja === "");

  check("空文字は落とす", normalizeTargetPhrases(undefined, ["", "  "]).length === 0);
  check("配列でなければ0件", normalizeTargetPhrases(undefined, null).length === 0);
}

section("派生語の正規化");
{
  const ds = normalizeDerivatives([
    { word: "help", pos: "名", meaning: "助け，手伝い" },
    { word: "", pos: "名", meaning: "捨てられる" },
    "壊れた値",
  ]);
  check("正しい項目だけ残る", ds.length === 1 && ds[0].word === "help", ds);
  check("配列でなければ0件", normalizeDerivatives(undefined).length === 0);
}

section("既存ドキュメントの取り込み");
{
  // 43件の既存データ（v1）を想定。senses も targetPhrases も保存されていない
  const legacy = normalizeWord("old", {
    word: "change",
    meaning: "を変える；変わる；を替える",
    grammar: "動詞",
    collocations: ["change one's life「〜の人生を変える」"],
    timestamp: base,
  });

  check("v1 でも語義が3つに割れる", (legacy.senses ?? []).length === 3);
  check("v1 でもフレーズが1つ出る", (legacy.targetPhrases ?? []).length === 1);
  check("meaning は書き換えない", legacy.meaning === "を変える；変わる；を替える");
  check("schemaVersion は 1 のまま", legacy.schemaVersion === 1);
  check("補完の対象になる", needsBackfill(legacy));

  const upgraded = normalizeWord("new", {
    word: "help",
    meaning: "(人)を手伝う",
    senses: [{ ja: "(人)を手伝う，助ける" }, { ja: "(人)に役立つ" }],
    targetPhrases: [{ en: "help A with B", ja: "AのBを手伝う" }],
    derivatives: [{ word: "help", pos: "名", meaning: "助け" }],
    examLevel: "基礎",
    schemaVersion: TARGET_SCHEMA_VERSION,
    timestamp: base,
  });

  check("v3 は AI の語義を使う", upgraded.senses![1].ja === "(人)に役立つ");
  check("v3 は派生語を持つ", upgraded.derivatives!.length === 1);
  check("v3 の examLevel", upgraded.examLevel === "基礎");
  check("v3 は補完の対象外", !needsBackfill(upgraded));

  // 取り込み待ちの語を補完対象に混ぜない（詳細生成が先）
  const stillPending = normalizeWord("p", {
    word: "x",
    meaning: "x",
    enrichStatus: "pending",
    timestamp: base,
  });
  check("取り込み待ちは補完対象にしない", !needsBackfill(stillPending));
}

section("和訳の欠けた例文");
{
  // 旧スキーマの "英文\n和訳" 形式で、和訳が入っていないもの
  const noJa = normalizeWord("a", {
    word: "change",
    meaning: "を変える",
    examples: ["This book changed my life."],
    schemaVersion: TARGET_SCHEMA_VERSION,
    timestamp: base,
  });
  check("和訳が無い例文を検出する", lacksExampleJa(noJa));
  check("v3 でも作り直しの対象にする", needsBackfill(noJa));

  const withJa = normalizeWord("b", {
    word: "change",
    meaning: "を変える",
    examples: ["This book changed my life.\nこの本は私の人生を変えた。"],
    schemaVersion: TARGET_SCHEMA_VERSION,
    timestamp: base,
  });
  check("和訳があれば対象外", !lacksExampleJa(withJa) && !needsBackfill(withJa));

  const objectForm = normalizeWord("c", {
    word: "help",
    meaning: "を手伝う",
    examples: [{ en: "She helped me.", ja: "彼女は私を手伝った。" }],
    schemaVersion: TARGET_SCHEMA_VERSION,
    timestamp: base,
  });
  check("組で保存された例文も読める", objectForm.examplePairs![0].ja === "彼女は私を手伝った。");
  check("組の形式は対象外", !needsBackfill(objectForm));

  const noExample = normalizeWord("d", {
    word: "x",
    meaning: "x",
    examples: [],
    schemaVersion: TARGET_SCHEMA_VERSION,
    timestamp: base,
  });
  check("例文が0件なら和訳欠けではない", !lacksExampleJa(noExample));
}

section("語義①の色分け");
{
  // 目的語の注記は黒のまま、覚える対象だけを色付きにする
  const help = splitPrimarySense("(人)を手伝う，助ける");
  check("目的語の注記は色を付けない", help.lead === "(人)", help);
  check("覚える対象を切り出す", help.core === "を手伝う，助ける", help.core);

  // 括弧の中が助詞だけなら訳の一部。ここを黒にすると「学ぶ」が浮いてしまう
  const learn = splitPrimarySense("(を)学ぶ");
  check("助詞だけの括弧は色を付ける側に含める", learn.lead === "" && learn.core === "(を)学ぶ", learn);

  const plain = splitPrimarySense("乱流");
  check("括弧が無ければ全体が対象", plain.lead === "" && plain.core === "乱流");

  const thing = splitPrimarySense("(物・事)を変える，変更する");
  check("中黒を含む注記も外に出す", thing.lead === "(物・事)", thing.lead);

  check("空でも落ちない", splitPrimarySense("").core === "");
}

section("語義の頭の助詞");
{
  check("を変える", splitParticle("を変える").particle === "を");
  check("に尋ねる", splitParticle("に尋ねる").particle === "に");
  check("括弧付きの (を)", splitParticle("(を)学ぶ").particle === "(を)", splitParticle("(を)学ぶ"));
  check("本体が残る", splitParticle("を変える").rest === "変える");
  check("助詞が無ければ切らない", splitParticle("変わる").particle === "" );
  check("内容語を助詞と誤らない", splitParticle("変化；おつり，小銭").rest === "変化；おつり，小銭");
  check("空でも落ちない", splitParticle("").rest === "");

  // 目的語の注記と組み合わせても壊れないこと
  const help = splitPrimarySense("(人)を手伝う，助ける");
  check("注記を外した後に助詞を切れる", splitParticle(help.core).particle === "を", help.core);
}

section("見出し語ごとのチェック枠");
{
  check("枠は2つ", WORD_CHECK_SLOTS === 2);

  const one = toggleCheck({}, "w1", 0);
  const two = toggleCheck(one, "w1", 1);
  check("2つとも付けられる", two.w1.join() === "0,1", two.w1);
  check("外せる", toggleCheck(two, "w1", 0).w1.join() === "1");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
