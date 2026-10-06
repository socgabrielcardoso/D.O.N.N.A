import { gateway } from "@ai-sdk/gateway";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { token, url } = await gateway.experimental_realtime.getToken({
      model: "openai/gpt-realtime-2.1",
    });

    return Response.json({
      token,
      url,
      tools: [],
      model: "openai/gpt-realtime-2.1",
    });
  } catch (error) {
    console.error("[realtime/token] failed", error);
    return Response.json(
      {
        error: "Não consegui iniciar a sessão de voz em tempo real.",
      },
      { status: 503 },
    );
  }
}
