import { research } from "../../../lib/research";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return Response.json({ error: "q is required" }, { status: 400 });
  }

  try {
    const sources = await research(query);
    return Response.json({ query, sources });
  } catch (error) {
    console.error("[research] failed", error);
    return Response.json({ error: "research failed" }, { status: 502 });
  }
}
