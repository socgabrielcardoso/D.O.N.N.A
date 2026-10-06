import { gateway } from "@ai-sdk/gateway";
import { experimental_generateSpeech as generateSpeech } from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

type SpeechBody = {
  text?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SpeechBody;
    const text = body.text?.trim().slice(0, 5000) ?? "";

    if (!text) {
      return Response.json({ error: "Texto ausente." }, { status: 400 });
    }

    const result = await generateSpeech({
      model: gateway.speechModel("openai/tts-1"),
      text,
      voice: "nova",
      outputFormat: "mp3",
    });

    return new Response(result.audio.uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-DONNA-Provider": "vercel-ai-gateway-tts",
      },
    });
  } catch (error) {
    console.error("[speech] failed", error);
    return Response.json(
      { error: "Falha ao gerar voz no AI Gateway." },
      { status: 503 },
    );
  }
}
