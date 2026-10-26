import { gateway } from "@ai-sdk/gateway";
import { experimental_transcribe as transcribe } from "ai";
import { readBoundedBody } from "../../../lib/request-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  // Limit the *entire multipart stream* before formData() can buffer arbitrary
  // unauthenticated payloads into memory. Origin check is not authentication.
  const bounded = await readBoundedBody(
    request, "multipart/form-data", MAX_MULTIPART_BYTES,
  );
  if (!bounded.ok) return bounded.response;

  let value: FormDataEntryValue | null;
  try {
    const safeBytes = new Uint8Array(bounded.bytes.length);
    safeBytes.set(bounded.bytes);
    const form = await new Response(safeBytes, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    value = form.get("audio");
  } catch {
    return Response.json(
      { error: "Formulário de áudio inválido.", code: "INVALID_AUDIO_FORM" },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!(value instanceof File)) {
    return Response.json({ error: "Arquivo de áudio ausente." }, {
      status: 400, headers: NO_STORE,
    });
  }
  if (value.size <= 0 || value.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Áudio vazio ou acima do limite de 12 MB." }, {
      status: 413, headers: NO_STORE,
    });
  }
  if (value.type && !/^(audio\/(?:webm|ogg|wav|x-wav|mpeg|mp3|mp4|x-m4a)|video\/webm)(?:;.*)?$/i.test(value.type)) {
    return Response.json(
      { error: "Formato de áudio não suportado.", code: "INVALID_AUDIO_TYPE" },
      { status: 415, headers: NO_STORE },
    );
  }

  try {
    const audio = new Uint8Array(await value.arrayBuffer());
    const result = await transcribe({
      model: gateway.transcriptionModel("openai/whisper-1"),
      audio,
      abortSignal: AbortSignal.timeout(20000),
    });

    return Response.json({
      ok: true,
      text: result.text?.trim() ?? "",
      durationInSeconds: result.durationInSeconds,
      provider: "vercel-ai-gateway-stt",
    }, { headers: NO_STORE });
  } catch {
    // Never log raw provider response bodies, audio, or transcription content.
    console.error("[transcribe] provider unavailable");
    return Response.json(
      { error: "Falha ao transcrever áudio no AI Gateway." },
      { status: 503, headers: NO_STORE },
    );
  }
}
