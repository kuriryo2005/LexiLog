export const config = { runtime: "nodejs" };

export default function handler(_request: Request): Response {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { "content-type": "application/json" },
  });
}
