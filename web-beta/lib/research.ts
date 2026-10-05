export type ResearchSource = {
  title: string;
  url: string;
  excerpt: string;
};

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function wikipediaSearch(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    utf8: "1",
    format: "json",
  });

  const response = await fetch(`https://pt.wikipedia.org/w/api.php?${params}`, {
    cache: "no-store",
    headers: { "User-Agent": "DONNA-Web-Beta/0.2" },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    query?: { search?: Array<{ title?: string; snippet?: string }> };
  };

  return (data.query?.search ?? []).slice(0, 4).map((item) => {
    const title = item.title ?? "Wikipedia";
    return {
      title: `Wikipedia — ${title}`,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      excerpt: stripHtml(item.snippet ?? ""),
    };
  });
}

async function duckDuckGo(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    no_redirect: "1",
    skip_disambig: "1",
  });

  const response = await fetch(`https://api.duckduckgo.com/?${params}`, {
    cache: "no-store",
    headers: { "User-Agent": "DONNA-Web-Beta/0.2" },
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

  const isTopicGroup = (item: Topic | TopicGroup): item is TopicGroup =>
    "Topics" in item && Array.isArray(item.Topics);

  const sources: ResearchSource[] = [];
  if (data.AbstractText && data.AbstractURL) {
    sources.push({
      title: data.Heading || "DuckDuckGo",
      url: data.AbstractURL,
      excerpt: data.AbstractText,
    });
  }

  for (const item of data.RelatedTopics ?? []) {
    const topics: Topic[] = isTopicGroup(item) ? item.Topics ?? [] : [item];
    for (const topic of topics) {
      if (topic.Text && topic.FirstURL) {
        sources.push({
          title: topic.Text.split(" - ")[0] || "DuckDuckGo",
          url: topic.FirstURL,
          excerpt: topic.Text,
        });
      }
      if (sources.length >= 4) return sources;
    }
  }
  return sources;
}

export async function research(query: string): Promise<ResearchSource[]> {
  const [ddg, wiki] = await Promise.allSettled([
    duckDuckGo(query),
    wikipediaSearch(query),
  ]);

  const combined = [
    ...(ddg.status === "fulfilled" ? ddg.value : []),
    ...(wiki.status === "fulfilled" ? wiki.value : []),
  ];

  const unique = new Map<string, ResearchSource>();
  for (const source of combined) {
    if (!unique.has(source.url)) unique.set(source.url, source);
  }
  return [...unique.values()].slice(0, 6);
}

export function sourceContext(sources: ResearchSource[]): string {
  return sources
    .map(
      (source, index) =>
        `[Fonte ${index + 1}]\nTítulo: ${source.title}\nURL: ${source.url}\nTrecho: ${source.excerpt}`,
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
    .join(" ");

  return best
    ? `Pesquisei na internet. O material recuperado indica: ${best}`
    : `Pesquisei “${query}”, mas as fontes retornaram sem trecho suficiente para uma resposta confiável.`;
}
