import { isIP } from "node:net";

export type ResearchSource = {
  title: string;
  url: string;
  excerpt: string;
};

const USER_AGENT = "D.O.N.N.A.-Research/0.5 (+https://donna-ai-nine.vercel.app)";
const STOP_WORDS = new Set([
  "donna", "sobre", "explique", "pesquise", "busque", "procure", "para", "como",
  "qual", "quais", "quem", "onde", "esta", "estao", "voce", "atual", "atuais",
  "pode", "falar", "fale", "diga", "mais", "com", "que", "uma", "dos", "das",
  "the", "and", "what", "with", "from", "estou", "internet",
]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function relevant(query: string, source: ResearchSource): boolean {
  const required = tokens(query);
  if (!required.size) return false;
  const titleTokens = tokens(source.title);
  const excerptTokens = tokens(source.excerpt.slice(0, 500));
  return [...required].some(
    (word) => titleTokens.has(word) || excerptTokens.has(word),
  );
}

function stripMarkup(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function publicUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" || host.endsWith(".local") ||
      host.endsWith(".internal") || isIP(host) !== 0
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Research page enrichment is allowed only for exact, trusted Wikipedia hosts.
 * Search-result URLs remain links for the user, never targets for server fetch.
 * A prior public-DNS preflight followed by a second resolver in fetch() was
 * vulnerable to DNS rebinding / TOCTOU.
 */
export function trustedSummaryUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === "pt.wikipedia.org" || url.hostname === "en.wikipedia.org") &&
      url.pathname.startsWith("/wiki/") &&
      url.pathname.length > "/wiki/".length
    );
  } catch {
    return false;
  }
}

/**
 * A remote provider controls its response size. Limit consumed decoded bytes,
 * not just the string length after response.text()/response.json() has buffered it.
 */
async function boundedResponseText(response: Response, maxBytes: number): Promise<string | null> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null && Number(lengthHeader) > maxBytes) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const fragments: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      fragments.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const fragment of fragments) {
    result.set(fragment, offset);
    offset += fragment.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}

async function wikipediaSummary(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (!trustedSummaryUrl(url)) return "";
    const page = parsed.pathname.split("/wiki/")[1];
    if (!page) return "";
    const endpoint = `https://${parsed.hostname}/api/rest_v1/page/summary/${page}`;
    const response = await fetch(endpoint, {
      redirect: "error",
      signal: AbortSignal.timeout(4500),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return "";
    const summary = await boundedResponseText(response, 32 * 1024);
    if (!summary) return "";
    const data = JSON.parse(summary) as { extract?: string };
    return typeof data.extract === "string" ? data.extract.slice(0, 1100) : "";
  } catch {
    return "";
  }
}

async function readArticle(url: string): Promise<string> {
  // Arbitrary external article fetches are intentionally disabled. The prior
  // DNS check could not pin the resolved address used by fetch().
  if (!trustedSummaryUrl(url)) return "";
  return wikipediaSummary(url);
}

async function duckDuckGo(query: string): Promise<ResearchSource[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR" },
    });
    if (!response.ok) return [];
    const html = await boundedResponseText(response, 300 * 1024);
    if (!html) return [];
    const rx = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const found: ResearchSource[] = [];
    let match: RegExpExecArray | null;
    while ((match = rx.exec(html)) && found.length < 6) {
      const raw = new URL(match[1], "https://duckduckgo.com");
      const target = raw.searchParams.get("uddg") || raw.toString();
      const safe = publicUrl(target);
      if (!safe) continue;
      const source = { title: stripMarkup(match[2]), url: safe, excerpt: "" };
      if (relevant(query, source) && !found.some((item) => item.url === safe)) {
        found.push(source);
      }
    }
    return found;
  } catch {
    return [];
  }
}

async function wikipediaSearch(query: string): Promise<ResearchSource[]> {
  try {
    const endpoint = new URL("https://pt.wikipedia.org/w/api.php");
    endpoint.search = new URLSearchParams({
      action: "query", list: "search", srsearch: query,
      format: "json", srlimit: "4",
    }).toString();
    const response = await fetch(endpoint, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return [];
    const raw = await boundedResponseText(response, 64 * 1024);
    if (!raw) return [];
    const data = JSON.parse(raw) as {
      query?: { search?: Array<{ title?: string; snippet?: string }> };
    };
    return (data.query?.search || []).map((item) => {
      const title = item.title || "";
      return {
        title,
        url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        excerpt: stripMarkup(item.snippet || "").slice(0, 300),
      };
    }).filter((item) => relevant(query, item));
  } catch {
    return [];
  }
}

export async function research(query: string): Promise<ResearchSource[]> {
  const trimmed = query.trim().slice(0, 170);
  if (!trimmed || !tokens(trimmed).size) return [];
  const found = await Promise.allSettled([duckDuckGo(trimmed), wikipediaSearch(trimmed)]);
  const sources = found.flatMap((item) => item.status === "fulfilled" ? item.value : []);
  const deduped = [...new Map(sources.map((item) => [item.url, item])).values()]
    .filter((item) => relevant(trimmed, item))
    .slice(0, 4);
  const enriched = await Promise.all(deduped.map(async (item, index) => ({
    ...item,
    excerpt: index < 3 ? (await readArticle(item.url)) || item.excerpt : item.excerpt,
  })));
  return enriched.filter((item) => relevant(trimmed, item));
}

export function sourceContext(sources: ResearchSource[]): string {
  return sources.slice(0, 3).map((source, i) => (
    `[Fonte ${i + 1}] ${source.title}\nURL: ${source.url}\nTrecho: ${source.excerpt.slice(0, 1400)}`
  )).join("\n\n");
}

// Safe compatibility function. Never output a raw page as an "answer".
export function extractiveAnswer(_query: string, _sources: ResearchSource[]): string {
  return "O modelo de IA não está disponível. Não vou substituir uma resposta por texto bruto de sites.";
}
