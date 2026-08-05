import { SavedWord } from "../types";

/**
 * 単語のつながり図（KnowledgeMap）のデータ作成。
 *
 * 描画から切り離してここに置く。理由は二つある。
 *   - canvas 描画のコードに混ざっていると、線が引かれない原因を追えない
 *   - scripts/verify-graph.ts から素の関数として検証できる
 */

export type GraphLayer = "etymology" | "synonym" | "antonym";

export type NodeKind = "word" | "root" | "ghost";

export interface MapNode {
  id: string;
  kind: NodeKind;
  /** 画面に出す文字。語根ノードは語根そのもの */
  label: string;
  meaning: string;
  /** 語根ノードだけ持つ。展開 API に渡す */
  root?: string;
  /** 0..1。語ノードは importanceScore、それ以外は隣接数から決める */
  importance: number;
  /** 隣接する「保存済みの語」の数。語根とゴーストの大きさに使う */
  degree: number;
  /** 復習の遅れ。0 なら遅れていない */
  daysOverdue: number;
  data?: SavedWord;
}

export interface MapLink {
  source: string;
  target: string;
  kind: "root" | "direct" | "synonym" | "antonym";
  /** 線に添える語根。direct / synonym / antonym では空 */
  label: string;
}

export interface MapGraph {
  nodes: MapNode[];
  links: MapLink[];
}

const DAY = 1000 * 60 * 60 * 24;

/**
 * 語根を突き合わせる用の鍵に直す。
 *
 * AI は "spect", "spect (to look)", "-spect-", "SPECT" のように揺れた形で返す。
 * 揺れたままだと同じ語根が別ノードに割れて、房ができない。
 */
export function rootKey(raw: unknown): string {
  const text = String(raw ?? "").toLowerCase();
  // 括弧の中は語根ではなく語義なので落とす
  const head = text.split(/[(（]/)[0];
  const letters = head.replace(/[^a-z]/g, "");
  // 1文字は語根として意味を成さない（ノイズで房が繋がってしまう）
  return letters.length >= 2 ? letters : "";
}

function wordKey(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

function overdueDays(word: SavedWord): number {
  if (!word.nextReviewAt) return 0;
  return Math.max(0, (Date.now() - word.nextReviewAt) / DAY);
}

/**
 * 語源レイヤーは「語 → 語根 → 語」で組む。
 *
 * 以前は語 A の etymologyNodes に語 B が載っているときだけ A—B を結んでいた。
 * これは AI がその語を挙げたかどうかに依存するので、同じ語根を持つ inspect と
 * respect を両方保存していても線が出ないことがあった。語根を中間ノードにすると、
 * 同じ語根の語は列挙の有無に関係なく必ず一つの房に集まる。
 */
export function buildGraph(words: SavedWord[], layer: GraphLayer): MapGraph {
  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  /** 保存済みの語だけを引く索引。ゴーストは入れない */
  const savedByWord = new Map<string, MapNode>();
  const links: MapLink[] = [];
  const seenLink = new Set<string>();
  /** 語根/ゴーストごとの、隣接する保存済み語の集合 */
  const neighbors = new Map<string, Set<string>>();

  const push = (node: MapNode): MapNode => {
    const existing = byId.get(node.id);
    if (existing) return existing;
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  const connect = (from: MapNode, to: MapNode, kind: MapLink["kind"], label: string) => {
    if (from.id === to.id) return;
    // 向きは意味を持たないので、両向きの重複を一つにまとめる
    const key = [from.id, to.id].sort().join("|");
    if (seenLink.has(key)) return;
    seenLink.add(key);
    links.push({ source: from.id, target: to.id, kind, label });

    for (const [a, b] of [
      [from, to],
      [to, from],
    ] as const) {
      if (a.kind !== "word") continue;
      const set = neighbors.get(b.id) ?? new Set<string>();
      set.add(a.id);
      neighbors.set(b.id, set);
    }
  };

  for (const word of words) {
    if (!word.word) continue;
    const node = push({
      id: word.id,
      kind: "word",
      label: word.word,
      meaning: word.meaning ?? "",
      importance: typeof word.importanceScore === "number" ? word.importanceScore : 0.5,
      degree: 0,
      daysOverdue: overdueDays(word),
      data: word,
    });
    savedByWord.set(wordKey(word.word), node);
  }

  /** 未保存の関連語。押せば検索に回せるので、行き止まりにはしない */
  const ghostFor = (label: string, meaning: string): MapNode =>
    push({
      id: `ghost:${wordKey(label)}`,
      kind: "ghost",
      label,
      meaning,
      importance: 0.3,
      degree: 0,
      daysOverdue: 0,
    });

  if (layer === "etymology") {
    for (const word of words) {
      const self = byId.get(word.id);
      if (!self) continue;

      for (const ref of word.etymologyNodes ?? []) {
        if (!ref?.word) continue;
        const rk = rootKey(ref.root);
        const refKey = wordKey(ref.word);
        const target =
          savedByWord.get(refKey) ?? (refKey === wordKey(word.word) ? self : ghostFor(ref.word, ref.meaning ?? ""));

        if (!rk) {
          // 語根が取れないデータは、従来どおり語どうしを直接結ぶ
          connect(self, target, "direct", "");
          continue;
        }

        const root = push({
          id: `root:${rk}`,
          kind: "root",
          label: ref.root ? String(ref.root).split(/[(（]/)[0].trim() : rk,
          meaning: ref.relation ?? "",
          root: rk,
          importance: 0.5,
          degree: 0,
          daysOverdue: 0,
        });
        // 語義の説明は、空でない最初のものを採用する
        if (!root.meaning && ref.relation) root.meaning = ref.relation;

        connect(self, root, "root", root.label);
        connect(target, root, "root", root.label);
      }
    }
  } else if (layer === "synonym") {
    for (const word of words) {
      const self = byId.get(word.id);
      if (!self) continue;
      for (const syn of word.synonyms ?? []) {
        if (!syn?.word) continue;
        const target =
          savedByWord.get(wordKey(syn.word)) ??
          ghostFor(syn.word, syn.translation ?? "");
        connect(self, target, "synonym", "");
      }
    }
  } else {
    // antonym
    for (const word of words) {
      const self = byId.get(word.id);
      if (!self) continue;
      for (const ant of word.antonyms ?? []) {
        if (!ant?.word) continue;
        const target =
          savedByWord.get(wordKey(ant.word)) ??
          ghostFor(ant.word, ant.translation ?? "");
        connect(self, target, "antonym", "");
      }
    }
  }

  for (const node of nodes) {
    node.degree = neighbors.get(node.id)?.size ?? 0;
    if (node.kind !== "word") {
      // 保存済みの語をたくさん抱える語根ほど大きく描く
      node.importance = Math.min(1, 0.2 + node.degree * 0.2);
    }
  }

  return { nodes, links };
}

/** 語根ノードのうち、まだ1語しか押さえていないもの。次に伸ばす余地がある */
export function thinRoots(graph: MapGraph): MapNode[] {
  return graph.nodes
    .filter((n) => n.kind === "root" && n.degree === 1)
    .sort((a, b) => a.label.localeCompare(b.label));
}
