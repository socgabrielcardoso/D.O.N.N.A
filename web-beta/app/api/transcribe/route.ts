import { gateway } from "@ai-sdk/gateway";
import { experimental_transcribe as transcribe } from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const value = form.get("audio");

    if (!(value instanceof File)) {
      return Response.json({ error: "Arquivo de áudio ausente." }, { status: 400 });
    }

    if (value.size <= 0 || value.size > MAX_AUDIO_BYTES) {
      return Response.json(
        { error: "Áudio vazio ou acima do limite de 12 MB." },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await value.arrayBuffer());
    const result = await transcribe({
      model: gateway.transcriptionModel("openai/whisper-1"),
      audio: bytes,
    });

    return Response.json({
      ok: true,
      text: result.text?.trim() ?? "",
      durationInSeconds: result.durationInSeconds,
      provider: "vercel-ai-gateway-stt",
    });
  } catch (error) {
    console.error("[transcribe] failed", error);
    return Response.json(
      { error: "Falha ao transcrever áudio no AI Gateway." },
      { status: 503 },
    );
  }
}
