/**
 * API ハンドラの共通処理（実装仕様書 F1）。
 *
 * Web 標準の Request / Response で書いてあるため、Vercel Functions でも
 * Vite の開発サーバー（scripts/devApiPlugin.ts）でも同じコードが動く。
 */

import { AuthError, requireUser, type AuthedUser } from "./auth.js";
import { consume, RateLimitError, type RateLimitName } from "./ratelimit.js";

export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(status: number, message: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
}

/**
 * POST + 認証 + レート制限をまとめて処理する。
 * 認証に通ればハンドラを呼び、失敗すれば適切なステータスを返す。
 */
export async function withAuth(
  request: Request,
  limit: RateLimitName,
  handler: (user: AuthedUser, body: Record<string, unknown>) => Promise<Response>
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(405, "POST を使ってください。");
  }

  let user: AuthedUser;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof AuthError) return errorResponse(401, "ログインが必要です。");
    throw e;
  }

  try {
    consume(limit, user.uid);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "リクエストが多すぎます。しばらく待ってから試してください。", {
        retryAfterSec: e.retryAfterSec,
      });
    }
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "リクエストの形式が正しくありません。");
  }

  try {
    return await handler(user, body);
  } catch (e) {
    console.error(`[api:${limit}] handler error`, e);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("GEMINI_API_KEY")) {
      return errorResponse(500, "サーバーの設定が不足しています。");
    }
    return errorResponse(502, "AI の応答に失敗しました。");
  }
}

/** Server-Sent Events の1行を組み立てる。 */
export function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};
