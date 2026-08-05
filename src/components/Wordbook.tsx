/**
 * 単語帳（紙面の見開きを画面と印刷で再現する）。
 *
 * レイアウトは見開き全体でひとつの CSS グリッドにしてある。
 * 左右のページを別要素に分けると、同じ単語の行が左右でずれる。
 * ずれない紙面がこの体裁の要なので、行の高さはグリッドに揃えさせる。
 *
 * 配色と体裁は既存の紙の単語帳に合わせた（見出し帯・番号付き語義・
 * ▶ のフレーズ・英文中の見出し語を赤・和訳の対応部分を青・小口のツメ）。
 */

import React, { useCallback, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SavedWord } from "../types";
import {
  REVIEW_DAYS,
  Unit,
  WORD_CHECK_SLOTS,
  WordbookChecks,
  buildUnits,
  formatShortDate,
  loadChecks,
  loadStartDates,
  loadWordChecks,
  meaningSource,
  posBadge,
  reviewDate,
  saveChecks,
  saveStartDates,
  saveWordChecks,
  sentenceOf,
  splitByTarget,
  splitJaByMeaning,
  splitParticle,
  splitPrimarySense,
  toggleCheck,
} from "../lib/wordbook";
import { useTargetBackfill } from "../hooks/useTargetBackfill";

interface Props {
  words: SavedWord[];
  onWordClick?: (word: SavedWord) => void;
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

/** A / B / do / ~ などの差し替え位置。紙面では斜体になっている。 */
const SLOT = /^(?:[A-Z]|do|doing|done|one's|oneself|~|…|\.\.\.)$/;

/** ターゲットフレーズの型。差し替え位置だけを斜体にする。 */
const Frame: React.FC<{ en: string; primary?: boolean }> = ({ en, primary }) => (
  <span className={primary ? "wb-frame" : "wb-frame-sub"}>
    {en.split(/(\s+)/).map((token, i) =>
      SLOT.test(token.replace(/[()（）]/g, "")) ? (
        <i key={i}>{token}</i>
      ) : (
        <React.Fragment key={i}>{token}</React.Fragment>
      )
    )}
  </span>
);

/**
 * 赤シートで隠す部分。
 * クリックでその箇所だけ開く（もう一度押すと戻る）。
 */
const Hide: React.FC<{
  k: string;
  revealed: Set<string>;
  onReveal: (key: string) => void;
  className?: string;
  children: React.ReactNode;
}> = ({ k, revealed, onReveal, className, children }) => (
  <span
    className={`wb-hide${revealed.has(k) ? " is-shown" : ""}${className ? ` ${className}` : ""}`}
    onClick={(e) => {
      e.stopPropagation();
      onReveal(k);
    }}
  >
    {children}
  </span>
);

/**
 * 語義の表示。頭の格助詞だけ小さく組む。
 * 「を変える」の「を」が小さいことで内容語が拾いやすくなる。
 */
const Gloss: React.FC<{ ja: string }> = ({ ja }) => {
  const { particle, rest } = splitParticle(ja);
  return (
    <>
      {particle && <span className="wb-particle">{particle}</span>}
      {rest}
    </>
  );
};

/** 画面に一度に出す見開きの数。印刷時は全ユニットを出す。 */
const VISIBLE_STEP = 8;

/** 色を付けた文字列を描く。 */
const Marked: React.FC<{ parts: { text: string; hit: boolean }[]; tone: "red" | "blue" }> = ({
  parts,
  tone,
}) => (
  <>
    {parts.map((part, i) =>
      part.hit ? (
        <strong key={i} className={tone === "red" ? "wb-hit-red" : "wb-hit-blue"}>
          {part.text}
        </strong>
      ) : (
        <React.Fragment key={i}>{part.text}</React.Fragment>
      )
    )}
  </>
);

/** 巻頭の到達マップ（進捗を面で見せる）。 */
const ProgressMap: React.FC<{
  units: Unit[];
  checks: WordbookChecks;
  onJump: (index: number) => void;
}> = ({ units, checks, onJump }) => {
  const doneCount = units.filter(
    (u) => (checks[u.unitId] ?? []).length >= REVIEW_DAYS.length
  ).length;
  const totalChecks = units.length * REVIEW_DAYS.length;
  const madeChecks = units.reduce((sum, u) => sum + (checks[u.unitId] ?? []).length, 0);

  return (
    <div className="wb-map wb-noprint">
      <div className="wb-map-head">
        <span className="wb-map-title">到達マップ</span>
        <span className="wb-map-stat">
          {units.length} ユニット · 完了 {doneCount} · チェック {madeChecks} / {totalChecks}
        </span>
      </div>

      <div className="wb-map-grid">
        {units.map((unit) => {
          const done = (checks[unit.unitId] ?? []).length;
          return (
            <button
              key={unit.unitId}
              type="button"
              onClick={() => onJump(unit.index)}
              title={`Unit ${unit.label} · ${unit.from}–${unit.to} 語目 · ${done}/4`}
              className="wb-map-cell"
              style={{ opacity: done === 0 ? 0.18 : 0.25 + (done / REVIEW_DAYS.length) * 0.75 }}
            >
              {unit.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** 右ページ上部の目盛り。本全体のどこを開いているかを示す。 */
const Ruler: React.FC<{ from: number; to: number; total: number }> = ({ from, to, total }) => {
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);

  // 目盛りが 5 本以内に収まる「きりのいい」刻みを選ぶ。
  // 固定幅にすると語数が少ないうちは目盛りが 1 本も出ない。
  const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  const step = NICE.find((s) => total / s <= 5) ?? 1000;

  const ticks: number[] = [];
  for (let n = step; n <= total; n += step) ticks.push(n);

  return (
    <div className="wb-ruler">
      <div className="wb-ruler-track">
        <div
          className="wb-ruler-span"
          style={{ left: `${pct(from - 1)}%`, width: `${Math.max(1.5, pct(to) - pct(from - 1))}%` }}
        />
        {ticks.map((n) => (
          <span key={n} className="wb-ruler-tick" style={{ left: `${pct(n)}%` }}>
            <i />
            <em>{n}</em>
          </span>
        ))}
      </div>
    </div>
  );
};

/** 見開き 1 枚 = 1 セッション。 */
const Spread: React.FC<{
  unit: Unit;
  total: number;
  checks: WordbookChecks;
  wordChecks: WordbookChecks;
  startedAt: number;
  revealed: Set<string>;
  onReveal: (key: string) => void;
  onToggle: (unit: Unit, day: number) => void;
  onToggleWord: (wordId: string, slot: number) => void;
  onWordClick?: (word: SavedWord) => void;
}> = ({
  unit,
  total,
  checks,
  wordChecks,
  startedAt,
  revealed,
  onReveal,
  onToggle,
  onToggleWord,
  onWordClick,
}) => {
  const checked = checks[unit.unitId] ?? [];

  return (
    <article className="wb-spread" id={`wb-unit-${unit.index}`}>
      {/* 見出し帯（左ページ） */}
      <div className="wb-head-left">
        <span className="wb-unit-no">Unit {unit.label}</span>
        <span className="wb-unit-sub">
          {unit.from}–{unit.to} 語目
        </span>

        {/* 復習スケジュールを紙面に印刷する */}
        <div className="wb-days">
          {REVIEW_DAYS.map((day) => {
            const done = checked.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => onToggle(unit, day)}
                className={`wb-day${done ? " is-done" : ""}`}
                title={`${reviewDate(startedAt, day).toLocaleDateString("ja-JP")} に復習`}
              >
                <span className="wb-day-box">{done ? "✓" : ""}</span>
                <span className="wb-day-text">
                  Day{day}
                  <em>{formatShortDate(reviewDate(startedAt, day))}</em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wb-head-gutter" />

      {/* 目盛り（右ページ） */}
      <div className="wb-head-right">
        <Ruler from={unit.from} to={unit.to} total={total} />
      </div>

      {/* 本文。1 語につき 5 セル（見出し / 語義 / 折り / 英文 / 和訳） */}
      {unit.words.map((word, wordIndex) => {
        // senses / targetPhrases は normalizeWord が meaning・collocations からも作る。
        // v3 未満の既存ドキュメントでも紙面が埋まるのはこのため。
        const senses = word.senses ?? [];
        const primary = senses[0] ? splitPrimarySense(senses[0].ja) : null;
        const phrases = (word.targetPhrases ?? []).slice(0, 4);
        const sentence = sentenceOf(word);

        return (
          <React.Fragment key={word.id}>
            <div className="wb-c-word">
              <button
                type="button"
                className="wb-word"
                onClick={() => onWordClick?.(word)}
                title="詳細を開く"
              >
                {word.word}
              </button>
              {word.phonetic && <span className="wb-phonetic">[{word.phonetic}]</span>}

              {/* 見出し語ごとのチェック枠と通し番号 */}
              <div className="wb-word-foot">
                <span className="wb-checks">
                  {Array.from({ length: WORD_CHECK_SLOTS }, (_, slot) => {
                    const done = (wordChecks[word.id] ?? []).includes(slot);
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => onToggleWord(word.id, slot)}
                        className={`wb-check${done ? " is-done" : ""}`}
                        title={`${slot + 1} 回目の確認`}
                      >
                        {done ? "✓" : ""}
                      </button>
                    );
                  })}
                </span>
                <span className="wb-serial">{unit.from + wordIndex}</span>
              </div>
            </div>

            <div className="wb-c-sense">
              <div className="wb-sense-line">
                <span className="wb-pos">{posBadge(word.grammar)}</span>
                <span className="wb-senses">
                  {/* 語義①だけが大きく色付き。目的語の注記と助詞は組み方を変える */}
                  {primary && (
                    <span className="wb-sense-primary">
                      {primary.lead && <span className="wb-lead">{primary.lead}</span>}
                      <Hide
                        k={`${word.id}:core`}
                        revealed={revealed}
                        onReveal={onReveal}
                        className="wb-core"
                      >
                        <Gloss ja={primary.core} />
                      </Hide>
                    </span>
                  )}
                  {senses.slice(1).map((sense, i) => (
                    <span key={i} className="wb-sense-rest">
                      ；{sense.pos && <b className="wb-pos-inline">{sense.pos}</b>}
                      <Hide k={`${word.id}:s${i}`} revealed={revealed} onReveal={onReveal}>
                        <Gloss ja={sense.ja} />
                      </Hide>
                    </span>
                  ))}
                </span>
              </div>

              {/* ターゲットフレーズ。先頭の1本だけ TG 印を付けて強く出す */}
              {phrases.map((p, i) =>
                i === 0 ? (
                  <div key={`p${i}`} className="wb-tg-line">
                    <span className="wb-tg">TG</span>
                    <Frame en={p.en} primary />
                    {p.ja && (
                      <span className="wb-gloss">
                        「
                        <Hide k={`${word.id}:p${i}`} revealed={revealed} onReveal={onReveal}>
                          {p.ja}
                        </Hide>
                        」
                      </span>
                    )}
                  </div>
                ) : (
                  <div key={`p${i}`} className="wb-phrase">
                    <i className="wb-arrow">▶</i>
                    <Frame en={p.en} />
                    {p.ja && (
                      <span className="wb-gloss">
                        「
                        <Hide k={`${word.id}:p${i}`} revealed={revealed} onReveal={onReveal}>
                          {p.ja}
                        </Hide>
                        」
                      </span>
                    )}
                  </div>
                )
              )}

              {/* 派生語。見出し語と同じつづりなら語は繰り返さない */}
              {(word.derivatives ?? []).slice(0, 3).map((d, i) => (
                <div key={`d${i}`} className="wb-derivative">
                  <span className="wb-pos-mini">{d.pos || "語"}</span>
                  {d.word.toLowerCase() !== word.word.toLowerCase() && <Frame en={d.word} />}
                  <Hide
                    k={`${word.id}:d${i}`}
                    revealed={revealed}
                    onReveal={onReveal}
                    className="wb-gloss"
                  >
                    <Gloss ja={d.meaning} />
                  </Hide>
                </div>
              ))}
            </div>

            <div className="wb-c-gutter" />

            {/* 自然文（ニュアンス確認用） */}
            <div className="wb-c-en">
              {sentence ? (
                <p>
                  <Marked parts={splitByTarget(sentence.en, word.word)} tone="red" />
                </p>
              ) : (
                <span className="wb-blank" />
              )}
            </div>

            <div className="wb-c-ja">
              {sentence?.ja ? (
                <p>
                  <Hide k={`${word.id}:ja`} revealed={revealed} onReveal={onReveal}>
                    <Marked parts={splitJaByMeaning(sentence.ja, meaningSource(word))} tone="blue" />
                  </Hide>
                </p>
              ) : (
                <span className="wb-blank" />
              )}
            </div>
          </React.Fragment>
        );
      })}

      {/* 書き込み用の余白 */}
      <div className="wb-memo">
        <span>メモ</span>
      </div>

      {/* ページ番号ではなく復習日で本を引く */}
      <div className="wb-foot">
        <span>
          U-{unit.label}
          <em>
            次の復習 {formatShortDate(reviewDate(startedAt, REVIEW_DAYS[checked.length] ?? 21))}
          </em>
        </span>
        <span>ここまでで {unit.cumulative} 語</span>
      </div>

      {/* 小口のツメ */}
      <div className="wb-tab">Unit {unit.label}</div>
    </article>
  );
};

export const Wordbook: React.FC<Props> = ({ words, onWordClick }) => {
  const units = useMemo(() => buildUnits(words), [words]);
  const backfill = useTargetBackfill(words);
  const [checks, setChecks] = useState<WordbookChecks>(loadChecks);
  const [wordChecks, setWordChecks] = useState<WordbookChecks>(loadWordChecks);
  const [startDates, setStartDates] = useState<Record<string, number>>(loadStartDates);

  const handleToggleWord = useCallback((wordId: string, slot: number) => {
    setWordChecks((prev) => {
      const updated = toggleCheck(prev, wordId, slot);
      saveWordChecks(updated);
      return updated;
    });
  }, []);
  const [visible, setVisible] = useState(VISIBLE_STEP);
  /** 赤シートを重ねた状態。訳を隠して自分で言えるか試す（実際の赤シートの代わり） */
  const [redSheet, setRedSheet] = useState(false);
  /** 赤シート中にクリックして開けた箇所 */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const handleReveal = useCallback((key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const startedAtOf = (unit: Unit) =>
    startDates[unit.unitId] ?? unit.words[0]?.timestamp ?? Date.now();

  const handleToggle = (unit: Unit, day: number) => {
    const current = checks[unit.unitId] ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);

    setChecks((prev) => {
      const updated = { ...prev, [unit.unitId]: next };
      saveChecks(updated);
      return updated;
    });

    // 最初のチェックを入れた日を Day1 の起点として記録する
    if (current.length === 0 && next.length > 0 && !startDates[unit.unitId]) {
      setStartDates((prev) => {
        const updated = { ...prev, [unit.unitId]: Date.now() };
        saveStartDates(updated);
        return updated;
      });
    }
  };

  const jumpTo = (index: number) => {
    if (index >= visible) setVisible(index + 1);
    requestAnimationFrame(() => {
      document.getElementById(`wb-unit-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  if (words.length === 0) {
    return (
      <div className="h-full flex flex-col justify-center max-w-xl mx-auto w-full">
        <h2 className="text-3xl font-black text-[#1A1C1E] mb-3">単語帳に載せる語がありません</h2>
        <p className="text-sm text-[#656E77] leading-relaxed">
          単語を保存すると、7 語ずつの見開きに組んで表示します。そのまま印刷できます。
        </p>
      </div>
    );
  }

  const shown = units.slice(0, visible);

  return (
    <div className={`wb-root${redSheet ? " wb-sheet-on" : ""}`}>
      {/* 画面をスクロールしても赤シートを切り替えられるよう上に貼り付ける */}
      <div className="wb-toolbar wb-noprint">
        <div>
          <h2 className="text-2xl font-black text-[#1A1C1E]">単語帳</h2>
          <p className="text-sm text-[#8A9199] mt-1">
            見開き 1 枚が 1 回分です。Day1 / 3 / 7 / 21 の枠に印を付けて進めます。赤シートをオンにすると訳が隠れます。隠れた箇所をクリックすると答えが出ます。
          </p>
        </div>
        <div className="flex items-center gap-8 shrink-0">
          <button
            type="button"
            onClick={() => {
              setRedSheet((v) => !v);
              setRevealed(new Set());
            }}
            className={`text-sm font-bold border-b transition-colors ${
              redSheet
                ? "text-[#E4007F] border-[#E4007F]"
                : "text-[#1A1C1E] border-[#1A1C1E] hover:text-[#2A5CFF] hover:border-[#2A5CFF]"
            }`}
          >
            赤シート {redSheet ? "オン" : "オフ"}
          </button>
          <button type="button" onClick={() => window.print()} className="btn-quiet px-0 text-sm">
            <Printer className="w-4 h-4" />
            印刷
          </button>
        </div>
      </div>

      {/* 紙面用の項目がまだ入っていない語を作り直す。既存の情報は消さない */}
      {(backfill.pending > 0 || backfill.running) && (
        <div className="wb-noprint wb-backfill">
          <div>
            <p className="wb-backfill-title">
              {backfill.running
                ? `単語帳の情報を生成中  ${backfill.done} / ${backfill.total}`
                : `${backfill.pending} 語に単語帳用の情報がありません`}
            </p>
            <p className="wb-backfill-note">
              語義の番号分け・ターゲットフレーズ・派生語を AI で補います。
              これまでに調べた内容はそのまま残り、空欄だけが埋まります。
              {backfill.failed > 0 && ` 失敗 ${backfill.failed} 語。`}
            </p>
          </div>

          {backfill.running ? (
            <button type="button" onClick={backfill.cancel} className="btn-quiet px-0 text-sm">
              中止
            </button>
          ) : (
            <button type="button" onClick={backfill.start} className="btn-primary">
              {backfill.pending} 語を補完する
            </button>
          )}
        </div>
      )}

      <ProgressMap units={units} checks={checks} onJump={jumpTo} />

      {shown.map((unit) => (
        <Spread
          key={unit.unitId}
          unit={unit}
          total={words.length}
          checks={checks}
          wordChecks={wordChecks}
          startedAt={startedAtOf(unit)}
          revealed={revealed}
          onReveal={handleReveal}
          onToggle={handleToggle}
          onToggleWord={handleToggleWord}
          onWordClick={onWordClick}
        />
      ))}

      {visible < units.length && (
        <button
          type="button"
          onClick={() => setVisible((n) => n + VISIBLE_STEP)}
          className="wb-noprint text-xs font-bold text-[#2A5CFF] border-b border-[#2A5CFF] mt-2"
        >
          さらに表示（残り {units.length - visible} ユニット）
        </button>
      )}
    </div>
  );
};
