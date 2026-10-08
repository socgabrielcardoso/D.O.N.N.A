import { lookup } from "node:dns/promises";
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

async function publicDNS(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname;
    const resolved = await lookup(host, { all: true });
    return resolved.length > 0 && resolved.every(({ address }) => {
      const ip = normalize(address);
      if (ip.includes(":")) {
        return !ip.startsWith("fc") && !ip.startsWith("fd") &&
          !ip.startsWith("fe80") && ip !== "::1" && ip !== "::" &&
          !ip.startsWith("2001:db8:");
      }
      const parts = ip.split(".").map(Number);
      const a = parts[0], b = parts[1];
      if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) {
        return false;
      }
      if (
        a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || b === 0)) ||
        (a === 198 && (b === 18 || b === 19))
      ) return false;
      return true;
    });
  } catch {
    return false;
  }
}

async function wikipediaSummary(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("wikipedia.org")) return "";
    const page = parsed.pathname.split("/wiki/")[1];
    if (!page) return "";
    const endpoint = `https://${parsed.hostname}/api/rest_v1/page/summary/${page}`;
    const response = await fetch(endpoint, {
      redirect: "error",
      signal: AbortSignal.timeout(4500),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { extract?: string };
    return typeof data.extract === "string" ? data.extract.slice(0, 1100) : "";
  } catch {
    return "";
  }
}

async function readArticle(url: string): Promise<string> {
  const safe = publicUrl(url);
  if (!safe || !(await publicDNS(safe))) return "";
  const wiki = await wikipediaSummary(safe);
  if (wiki) return wiki;
  try {
    const response = await fetch(safe, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/plain;q=0.8",
      },
    });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") || "";
    if (!/text\/(?:html|plain)/i.test(type)) return "";
    const html = (await response.text()).slice(0, 180000);

    // Never return entire HTML pages. That previously made D.O.N.N.A. read
    // Wikipedia navigation, menus, edit controls and tables aloud.
    const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
      html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (article) {
      const text = stripMarkup(article[1]).slice(0, 1600);
      if (text.length >= 70) return text;
    }
    const meta = html.match(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']{20,})["']/i);
    return meta ? stripMarkup(meta[1]).slice(0, 900) : "";
  } catch {
    return "";
  }
}

async function duckDuckGo(query: string): Promise<ResearchSource[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR" },
    });
    if (!response.ok) return [];
    const html = (await response.text()).slice(0, 250000);
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
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
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
