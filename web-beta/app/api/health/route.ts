import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";

export const runtime = "nodejs";
export const maxDuration = 30;

function basic() {
  return {
    ok: true,
    service: "donna-web",
    version: "0.5",
    architecture: "cloud-only",
    localComputerDependency: false,
    ai: {
      gatewayAuthPresent: Boolean(
        process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
      ),
      primaryModel: process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4",
      directOpenAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      // IMPORTANT: environment presence alone does not prove inference works.
      inferenceVerified: false,
    },
    voice: {
      cloudSpeech: "openai/tts-1",
      preferredFemaleVoice: "nova",
      browserMaleVoiceFallback: false,
    },
  };
}

export async function GET() {
  // Passive and free diagnostic only; never claim inference succeeded.
  return Response.json(basic(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // SSO protects the project; require a same-origin request for this paid test.
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: "Same-origin required" }, { status: 403 });
  }

  const model = process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4";
  try {
    const result = await generateText({
      model: gateway(model),
      prompt: "Responda exatamente: DONNA_OK",
      maxOutputTokens: 100,
      abortSignal: AbortSignal.timeout(16000),
    });
    const success = Boolean(result.text?.trim());
    return Response.json({
      ...basic(),
      ai: {
        ...basic().ai,
        inferenceVerified: success,
        testStatus: success ? "success" : "empty-answer",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /401|403|unauthorized|forbidden/i.test(message)
      ? "AUTH"
      : /402|429|billing|credit|quota|budget/i.test(message)
        ? "BILLING_OR_LIMIT"
        : /404|model/i.test(message)
          ? "MODEL"
          : "PROVIDER_ERROR";

    console.error("[DONNA DIAG]", reason);
    return Response.json({
      ...basic(),
      ai: {
        ...basic().ai,
        inferenceVerified: false,
        testStatus: reason,
      },
    });
  }
}
