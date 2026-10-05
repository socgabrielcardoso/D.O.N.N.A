import {
  extractiveAnswer,
  research,
  sourceContext,
  type ResearchSource,
} from "../../../lib/research";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatBody = { message?: string };

async function openAIAnswer(message: string, sources: ResearchSource[]): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-6-luna";
  const payload = {
    model,
    store: false,
    instructions:
      "Você é D.O.N.N.A., assistente do Chefe. Responda em pt-BR, de forma direta. " +
      "Use as fontes fornecidas, diferencie incerteza de fato e não invente pesquisa.",
    input: `Pergunta: ${message}\n\nFONTES:\n${sourceContext(sources)}`,
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };

    if (data.output_text?.trim()) return data.output_text.trim();

    const text = (data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim();

    return text || null;
  } catch (error) {
    console.error("[chat] OpenAI fallback failed", error);
    return null;
  }
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const message = body.message?.trim() ?? "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  console.log("[chat] request", { chars: message.length });

  try {
    const sources = await research(message);
    const generated = await openAIAnswer(message, sources);
    const answer = generated ?? extractiveAnswer(message, sources);

    return Response.json({
      answer,
      sources,
      provider: generated ? "openai" : "web-extractive",
    });
  } catch (error) {
    console.error("[chat] failed", error);
    return Response.json(
      {
        answer: "A camada cloud encontrou um erro. O cliente Windows deve continuar usando o modo local.",
        sources: [],
        provider: "error",
      },
      { status: 200 },
    );
  }
}
