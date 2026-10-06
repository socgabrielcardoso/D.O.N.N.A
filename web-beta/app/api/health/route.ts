export const runtime = "nodejs";

async function gatewayDeepCheck(token: string): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.name : "unknown",
    };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";
  const gatewayToken =
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
  const gatewayConfigured = Boolean(gatewayToken);

  const gatewayCheck =
    deep && gatewayConfigured
      ? await gatewayDeepCheck(gatewayToken)
      : null;

  return Response.json({
    ok: true,
    service: "donna-web",
    version: "0.4",
    platform: "vercel",
    architecture: "cloud-only",
    timestamp: new Date().toISOString(),
    localComputerDependency: false,
    ai: {
      gatewayConfigured,
      gatewayReachable: gatewayCheck?.ok ?? null,
      gatewayStatus: gatewayCheck?.status ?? null,
      gatewayModel: process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4",
      openaiDirectConfigured: Boolean(process.env.OPENAI_API_KEY),
      fallback: "web-extractive",
    },
    capabilities: {
      webResearch: true,
      webpageReading: true,
      gatewayWebTools: true,
      cloudSpeechToText: true,
      cloudTextToSpeech: true,
      browserVoiceFallback: true,
      browserMemory: true,
      selectedFileAnalysis: true,
      realtimeTokenRoute: true,
    },
  });
}
