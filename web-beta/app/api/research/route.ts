import { research } from "../../../lib/research";

export const runtime = "nodejs";

// Search terms and source excerpts may contain personal or sensitive context.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return Response.json({ error: "q is required" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const sources = await research(query);
    return Response.json({ query, sources }, { headers: PRIVATE_HEADERS });
  } catch {
    // Never log remote snippets, user queries or provider exception payloads.
    console.error("[research] unavailable");
    return Response.json({ error: "research failed" }, { status: 502, headers: PRIVATE_HEADERS });
  }
}
