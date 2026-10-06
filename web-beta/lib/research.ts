export type ResearchSource = {
  title: string;
  url: string;
  excerpt: string;
};

const USER_AGENT =
  "Mozilla/5.0 (compatible; DONNA-Web/0.4; +https://donna-ai-nine.vercel.app)";

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safePublicUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const host = url.hostname.toLowerCase();
    const blocked =
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    return blocked ? null : url.toString();
  } catch {
    return null;
  }
}

async function fetchText(url: string, maxChars = 7000): Promise<string> {
  const safe = safePublicUrl(url);
  if (!safe) return "";

  try {
    const response = await fetch(safe, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
      },
    });

    if (!response.ok) return "";
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!type.includes("text/html") && !type.includes("text/plain")) return "";

    const text = stripHtml((await response.text()).slice(0, 500_000));
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

function decodeDuckDuckGoUrl(raw: string): string | null {
  try {
    const url = new URL(raw, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return safePublicUrl(target ? decodeURIComponent(target) : url.toString());
  } catch {
    return null;
  }
}

async function duckDuckGoHtml(query: string): Promise<ResearchSource[]> {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(7000),
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        },
      },
    );

    if (!response.ok) return [];
    const html = await response.text();
    const regex =
      /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    const results: ResearchSource[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) && results.length < 5) {
      const url = decodeDuckDuckGoUrl(match[1] ?? "");
      const title = stripHtml(match[2] ?? "");
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);
      results.push({ title, url, excerpt: "" });
    }

    return results;
  } catch {
    return [];
  }
}

async function wikipediaSearch(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    utf8: "1",
    format: "json",
    origin: "*",
  });

  try {
    const response = await fetch(`https://pt.wikipedia.org/w/api.php?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      query?: { search?: Array<{ title?: string; snippet?: string }> };
    };

    return (data.query?.search ?? []).slice(0, 3).map((item) => {
      const title = item.title ?? "Wikipedia";
      return {
        title: `Wikipedia — ${title}`,
        url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        excerpt: stripHtml(item.snippet ?? ""),
      };
    });
  } catch {
    return [];
  }
}

async function duckDuckGoInstant(query: string): Promise<ResearchSource[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      no_html: "1",
      no_redirect: "1",
      skip_disambig: "1",
    });

    const response = await fetch(`https://api.duckduckgo.com/?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return [];

    type Topic = { Text?: string; FirstURL?: string };
    type TopicGroup = { Topics?: Topic[] };

    const data = (await response.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<Topic | TopicGroup>;
    };

    const sources: ResearchSource[] = [];
    if (data.AbstractText && data.AbstractURL) {
      const url = safePublicUrl(data.AbstractURL);
      if (url) {
        sources.push({
          title: data.Heading || "DuckDuckGo",
          url,
          excerpt: data.AbstractText,
        });
      }
    }

    const isGroup = (item: Topic | TopicGroup): item is TopicGroup =>
      "Topics" in item && Array.isArray(item.Topics);

    for (const item of data.RelatedTopics ?? []) {
      const topics: Topic[] = isGroup(item) ? item.Topics ?? [] : [item];
      for (const topic of topics) {
        const url = topic.FirstURL ? safePublicUrl(topic.FirstURL) : null;
        if (topic.Text && url) {
          sources.push({
            title: topic.Text.split(" - ")[0] || "DuckDuckGo",
            url,
            excerpt: topic.Text,
          });
        }
        if (sources.length >= 4) return sources;
      }
    }

    return sources;
  } catch {
    return [];
  }
}

async function enrich(sources: ResearchSource[]): Promise<ResearchSource[]> {
  return Promise.all(
    sources.slice(0, 5).map(async (source, index) => {
      if (index > 2) return source;
      const page = await fetchText(source.url, 6500);
      return {
        ...source,
        excerpt: page || source.excerpt,
      };
    }),
  );
}

export async function research(query: string): Promise<ResearchSource[]> {
  const [htmlResults, instantResults, wikiResults] = await Promise.allSettled([
    duckDuckGoHtml(query),
    duckDuckGoInstant(query),
    wikipediaSearch(query),
  ]);

  const combined = [
    ...(htmlResults.status === "fulfilled" ? htmlResults.value : []),
    ...(instantResults.status === "fulfilled" ? instantResults.value : []),
    ...(wikiResults.status === "fulfilled" ? wikiResults.value : []),
  ];

  const unique = new Map<string, ResearchSource>();
  for (const source of combined) {
    if (!unique.has(source.url)) unique.set(source.url, source);
  }

  return enrich([...unique.values()].slice(0, 6));
}

export function sourceContext(sources: ResearchSource[]): string {
  return sources
    .map(
      (source, index) =>
        `[Fonte ${index + 1}]\nTítulo: ${source.title}\nURL: ${source.url}\nConteúdo: ${source.excerpt.slice(0, 5000)}`,
    )
    .join("\n\n");
}

export function extractiveAnswer(query: string, sources: ResearchSource[]): string {
  if (!sources.length) {
    return "Não consegui recuperar fontes públicas agora. Tente novamente em alguns segundos.";
  }

  const best = sources
    .map((source) => source.excerpt)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 3500);

  return best
    ? `Pesquisei na internet e li as fontes recuperadas. O conteúdo indica: ${best}`
    : `Pesquisei “${query}”, mas as fontes retornaram sem conteúdo suficiente para uma resposta confiável.`;
}
