import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import {
  gatewayCandidates,
  runInferenceProbes,
  type ProbeCandidate,
} from "../../../lib/diagnostics";

export const runtime = "nodejs";
export const maxDuration = 60;

const MARKER_PROMPT = "Responda com uma única linha, exatamente com o texto DONNA_OK. Não escreva explicações.";

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
      // Availability of credentials is not evidence of actual inference.
      inferenceVerified: false,
    },
    voice: {
      cloudSpeech: "openai/tts-1",
      preferredFemaleVoice: "nova",
      browserMaleVoiceFallback: false,
    },
  };
}

async function probeGateway(model: string, timeoutMs: number): Promise<string> {
  const generated = await generateText({
    model: gateway(model),
    prompt: MARKER_PROMPT,
    maxOutputTokens: 100,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return generated.text ?? "";
}

async function probeOpenAI(): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4",
      instructions: MARKER_PROMPT,
      input: MARKER_PROMPT,
      max_output_tokens: 100,
      store: false,
    }),
  });
  if (!response.ok) throw { statusCode: response.status };
  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  return data.output_text ||
    (data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("");
}

async function probeGemini(): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "";
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: MARKER_PROMPT }] }],
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0,
        },
      }),
    },
  );
  if (!response.ok) throw { statusCode: response.status };
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ?? "";
}

export async function GET() {
  return Response.json(basic(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // DIAG is explicitly user initiated, bounded to five attempts, and potentially
  // billable; do not run it automatically on page load.
  // Preserve the existing same-origin control.
  let originHost: string | undefined;
  try {
    originHost = new URL(request.headers.get("origin") || "").host;
  } catch {
    return Response.json({ error: "Same-origin required" }, { status: 403 });
  }
  if (!originHost || originHost !== new URL(request.url).host) {
    return Response.json({ error: "Same-origin required" }, { status: 403 });
  }

  const primaryModel = process.env.DONNA_GATEWAY_MODEL || "openai/gpt-5.4-mini";
  const probes: ProbeCandidate[] = gatewayCandidates(primaryModel).map((model, index) => ({
    provider: `ai-gateway:${model}`,
    run: () => probeGateway(model, index === 0 ? 12000 : 7000),
  }));
  if (process.env.OPENAI_API_KEY) {
    probes.push({ provider: "openai-direct", run: probeOpenAI });
  }
  if (process.env.GEMINI_API_KEY) {
    probes.push({ provider: "google-gemini-direct", run: probeGemini });
  }

  const result = await runInferenceProbes(probes);
  const info = basic();
  return Response.json({
    ...info,
    ai: { ...info.ai, ...result },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
