import { research } from "../../../lib/research";
import { privateJson, validatedResearchQuery } from "../../../lib/request-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = validatedResearchQuery(url.searchParams.get("q"));
  if (!query) {
    return privateJson(
      { error: "q must contain 1–170 printable characters", code: "INVALID_RESEARCH_QUERY" },
      { status: 400 },
    );
  }

  try {
    const sources = await research(query);
    return privateJson({ query, sources });
  } catch {
    // Research content and provider diagnostics must not enter server logs.
    console.error("[research] unavailable");
    return privateJson({ error: "research failed" }, { status: 502 });
  }
}
