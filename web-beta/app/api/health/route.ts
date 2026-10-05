export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    service: "donna-web-beta",
    platform: "vercel",
    timestamp: new Date().toISOString(),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}
