/** 診断用: モジュール読み込みエラーを可視化する */
export const config = { runtime: "nodejs" };

export default async function handler(_request: Request): Promise<Response> {
  const results: Record<string, unknown> = { node: process.version };
  const mods = [
    ["@google/genai", async () => { const m = await import("@google/genai"); return Object.keys(m).slice(0, 10); }],
    ["jose", async () => { const m = await import("jose"); return Object.keys(m).slice(0, 5); }],
    ["gemini", async () => {
      const m = await import("./_lib/gemini.js");
      return { MODEL: m.MODEL, FAST_THINKING: m.FAST_THINKING };
    }],
    ["auth", async () => {
      const m = await import("./_lib/auth.js");
      return Object.keys(m);
    }],
  ] as const;

  for (const [name, fn] of mods) {
    try { results[name] = await fn(); }
    catch (e) { results[name] = { error: e instanceof Error ? e.message : String(e) }; }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
