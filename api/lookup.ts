/**
 * POST /api/lookup — 単語検索（実装仕様書 F1）。
 *
 * Server-Sent Events で部分結果を流す。meaning などの軽い項目が先に届くよう
 * スキーマのプロパティ順を組んであるので、クライアントは全体の完成を待たずに
 * 描画できる。
 *
 * data: {"type":"partial","payload":{...}}
 * data: {"type":"done","payload":{...}}
 * data: {"type":"error","message":"..."}
 */

import { withAuth, sseEvent, SSE_HEADERS, errorResponse } from "./_lib/handler.js";
import {
  getClient,
  MODEL,
  WORD_SCHEMA,
  FAST_THINKING,
  buildLookupPrompt,
  modeLabel,
  type ModeSlug,
} from "./_lib/gemini.js";
import { parsePartialJson } from "./_lib/partialJson.js";

export const config = { runtime: "nodejs" };

const MAX_WORD_LENGTH = 64;
/** 部分結果を送る最小間隔。細かく送りすぎても描画が追いつかない。 */
const PARTIAL_INTERVAL_MS = 200;

export async function POST(request: Request): Promise<Response> {
  return withAuth(request, "lookup", async (_user, body) => {
    const word = String(body.word ?? "").trim().toLowerCase();
    const mode: ModeSlug = body.mode === "aca" ? "aca" : "gen";

    if (!word) return errorResponse(400, "単語が指定されていません。");
    if (word.length > MAX_WORD_LENGTH) {
      return errorResponse(400, `単語が長すぎます（${MAX_WORD_LENGTH}文字まで）。`);
    }

    const ai = getClient();
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: buildLookupPrompt(word, mode),
      config: {
        responseMimeType: "application/json",
        responseSchema: WORD_SCHEMA,
        thinkingConfig: FAST_THINKING,
      },
    });

    const encoder = new TextEncoder();

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        let lastSentAt = 0;
        let lastSentKeys = 0;

        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(sseEvent(payload)));
        };

        try {
          for await (const chunk of stream) {
            const text = chunk.text;
            if (!text) continue;
            buffer += text;

            const now = Date.now();
            if (now - lastSentAt < PARTIAL_INTERVAL_MS) continue;

            const partial = parsePartialJson(buffer);
            if (!partial) continue;

            // 新しいキーが増えていないなら送らない（同じ内容の再送を避ける）
            const keyCount = Object.keys(partial).length;
            if (keyCount <= lastSentKeys) continue;

            lastSentKeys = keyCount;
            lastSentAt = now;
            send({ type: "partial", payload: { ...partial, word, mode: modeLabel(mode) } });
          }

          const final = JSON.parse(buffer) as Record<string, unknown>;
          send({ type: "done", payload: { ...final, word, mode: modeLabel(mode) } });
        } catch (e) {
          console.error("[api:lookup] stream error", e);
          send({
            type: "error",
            message: e instanceof SyntaxError
              ? "AI の応答を解釈できませんでした。もう一度お試しください。"
              : "AI の応答に失敗しました。",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, { headers: SSE_HEADERS });
  });
}
