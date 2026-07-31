/**
 * 途中まで届いた JSON を、その時点で有効な JSON として解釈する。
 *
 * Gemini の構造化出力をストリーミングで受け取り、meaning が届いた時点で
 * 画面に出すために使う（実装仕様書 F1 / レイテンシ対策）。
 *
 * 未完成のキーや値は捨て、直前の「完成した値」までを切り出して
 * 開いているカッコを閉じる。
 */

type Container = "obj" | "arr";

const SCALAR_START = /[-0-9tfn]/;
const SCALAR_END = /[\s,}\]]/;

export function parsePartialJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 完成していればそのまま
  try {
    const done = JSON.parse(trimmed);
    return done && typeof done === "object" ? (done as Record<string, unknown>) : null;
  } catch {
    // 続行して部分解釈を試みる
  }

  const stack: Container[] = [];
  const expectKey: boolean[] = []; // stack と同じ深さ。obj のときのみ意味を持つ
  let inString = false;
  let escaped = false;

  let safeCut = -1;
  let safeStack: Container[] = [];

  const markSafe = (idx: number) => {
    safeCut = idx;
    safeStack = stack.slice();
  };

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        const top = stack[stack.length - 1];
        // オブジェクトのキーだった場合はまだ値が来ていないので安全地点にしない
        if (!(top === "obj" && expectKey[expectKey.length - 1])) {
          markSafe(i + 1);
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      stack.push("obj");
      expectKey.push(true);
      continue;
    }
    if (ch === "[") {
      stack.push("arr");
      expectKey.push(false);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      expectKey.pop();
      markSafe(i + 1);
      continue;
    }
    if (ch === ":") {
      expectKey[expectKey.length - 1] = false;
      continue;
    }
    if (ch === ",") {
      markSafe(i); // カンマの手前で切る
      if (stack[stack.length - 1] === "obj") expectKey[expectKey.length - 1] = true;
      continue;
    }

    // 数値 / true / false / null
    if (SCALAR_START.test(ch)) {
      let j = i;
      while (j < trimmed.length && !SCALAR_END.test(trimmed[j])) j++;
      if (j < trimmed.length) {
        // 区切り文字まで到達している = スカラーが完成している
        markSafe(j);
      }
      i = j - 1;
      continue;
    }
  }

  if (safeCut <= 0) return null;

  let candidate = trimmed.slice(0, safeCut).replace(/,\s*$/, "");
  for (let i = safeStack.length - 1; i >= 0; i--) {
    candidate += safeStack[i] === "obj" ? "}" : "]";
  }

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
