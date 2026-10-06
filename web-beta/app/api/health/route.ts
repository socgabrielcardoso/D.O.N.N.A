export const runtime = "nodejs";

export async function GET() {
  const gatewayConfigured = Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  );

  return Response.json({
    ok: true,
    service: "donna-web-beta",
    version: "0.3",
    platform: "vercel",
    timestamp: new Date().toISOString(),
    ai: {
      gatewayConfigured,
      gatewayModel: process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4",
      openaiDirectConfigured: Boolean(process.env.OPENAI_API_KEY),
      fallback: "web-extractive",
    },
    capabilities: {
      webResearch: true,
      browserVoice: true,
      browserMemory: true,
      selectedFileVisualization: true,
    },
  });
}
