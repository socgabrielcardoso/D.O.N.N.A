import { gateway } from "@ai-sdk/gateway";
import { experimental_generateSpeech as generateSpeech } from "ai";
import { parseJsonBody, readBoundedBody } from "../../../lib/request-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

type SpeechBody = { text?: unknown };

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const bounded = await readBoundedBody(request, "application/json", 16 * 1024);
  if (!bounded.ok) return bounded.response;

  const body = parseJsonBody<SpeechBody>(bounded.bytes);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  // Explicit rejection instead of quietly truncating chargeable text.
  if (!text || text.length > 3000) {
    return Response.json(
      { error: "O texto deve ter de 1 a 3000 caracteres.", code: "INVALID_SPEECH_TEXT" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await generateSpeech({
      model: gateway.speechModel("openai/tts-1"),
      text,
      voice: "nova",
      outputFormat: "mp3",
      abortSignal: AbortSignal.timeout(20000),
    });

    return Response.json({
      ok: true,
      audio: Buffer.from(result.audio.uint8Array).toString("base64"),
      mimeType: "audio/mpeg",
      provider: "vercel-ai-gateway-tts",
    }, { headers: NO_STORE });
  } catch {
    // SDK/provider exceptions may contain sensitive request metadata.
    console.error("[speech] provider unavailable");
    return Response.json(
      { error: "Falha ao gerar voz no AI Gateway." },
      { status: 503, headers: NO_STORE },
    );
  }
}
