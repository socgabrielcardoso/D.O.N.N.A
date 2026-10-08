import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";

export const runtime = "nodejs";
export const maxDuration = 30;

type TestResult = {
  inferenceVerified: boolean;
  testStatus: string;
  message: string;
  provider: string;
};

function basic() {
  return {
    ok: true,
    service: "donna-web",
    version: "0.6",
    architecture: "cloud-only",
    localComputerDependency: false,
    ai: {
      gatewayAuthPresent: Boolean(
        process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
      ),
      primaryModel: process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4-mini",
      googleFallbackConfigured: Boolean(process.env.GEMINI_API_KEY),
      directOpenAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      // The status is unknown until the model actually generates text.
      inferenceVerified: false,
    },
    voice: {
      cloudSpeech: "openai/tts-1",
      preferredFemaleVoice: "nova",
      browserMaleVoiceFallback: false,
    },
  };
}

function classify(error: unknown): TestResult {
  const record = typeof error === "object" && error !== null
    ? error as { message?: string; responseBody?: string; statusCode?: number }
    : {};
  const message = [record.message ?? String(error), record.responseBody || ""].join(" ");
  const code = record.statusCode;

  if (/customer_verification_required|verification.*required/i.test(message)) {
    return {
      inferenceVerified: false,
      testStatus: "ACCOUNT_VERIFICATION_REQUIRED",
      message: "A conta Vercel precisa concluir a verificação de pagamento para liberar os créditos do AI Gateway.",
      provider: "ai-gateway",
    };
  }
  if (code === 402 || /insufficient.*(credit|balance)|credit.*exhausted|payment_required/i.test(message)) {
    return {
      inferenceVerified: false,
      testStatus: "GATEWAY_CREDITS",
      message: "Saldo de créditos do AI Gateway indisponível ou esgotado.",
      provider: "ai-gateway",
    };
  }
  if (code === 429 || /rate.limit|too.many.requests/i.test(message)) {
    return {
      inferenceVerified: false,
      testStatus: "GATEWAY_RATE_LIMIT",
      message: "Limite temporário de requisições do modelo. Outro modelo pode funcionar.",
      provider: "ai-gateway",
    };
  }
  if (code === 401 || code === 403 || /unauthorized|forbidden/i.test(message)) {
    return {
      inferenceVerified: false,
      testStatus: "GATEWAY_AUTH",
      message: "O Gateway não aceitou a autenticação.",
      provider: "ai-gateway",
    };
  }
  if (code === 404 || /model.not.found|unsupported.model/i.test(message)) {
    return {
      inferenceVerified: false,
      testStatus: "GATEWAY_MODEL",
      message: "Modelo não disponível na conta Vercel.",
      provider: "ai-gateway",
    };
  }
  return {
    inferenceVerified: false,
    testStatus: "PROVIDER_ERROR",
    message: "A IA não conseguiu gerar texto. Verifique a conta do provedor.",
    provider: "ai-gateway",
  };
}

export async function GET() {
  return Response.json(basic(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // Diagnostic makes a small billable request; same-origin UI only.
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: "Same-origin required" }, { status: 403 });
  }

  const model = process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4-mini";
  let result: TestResult;

  try {
    const generated = await generateText({
      model: gateway(model),
      prompt: "Responda exatamente: DONNA_OK",
      maxOutputTokens: 100,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(14000),
    });
    const success = Boolean(generated.text?.trim());
    result = {
      inferenceVerified: success,
      testStatus: success ? "success" : "empty-answer",
      message: success
        ? "O modelo respondeu. A inteligência cloud está operacional."
        : "O modelo não retornou texto verificável.",
      provider: `ai-gateway:${model}`,
    };
  } catch (error) {
    result = classify(error);
  }

  return Response.json({
    ...basic(),
    ai: {
      ...basic().ai,
      ...result,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
