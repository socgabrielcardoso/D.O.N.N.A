from __future__ import annotations

import html
import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser


@dataclass(slots=True)
class ResearchResult:
    title: str
    url: str
    snippet: str
    page_excerpt: str = ""

    def context(self) -> str:
        body = self.page_excerpt.strip() or self.snippet.strip()
        return f"Título: {self.title}\nURL: {self.url}\nConteúdo: {body[:4500]}"


class _SearchParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[tuple[str, str]] = []
        self._in_result = False
        self._href = ""
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = {key: value or "" for key, value in attrs}
        classes = values.get("class", "")
        if "result__a" in classes:
            self._in_result = True
            self._href = values.get("href", "")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._in_result:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._in_result:
            title = html.unescape(" ".join(self._text)).strip()
            if title and self._href:
                self.results.append((title, self._href))
            self._in_result = False
            self._href = ""
            self._text = []


class _TextParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "canvas", "nav", "footer"}

    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self.SKIP:
            self.depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data: str) -> None:
        if self.depth:
            return
        text = re.sub(r"\s+", " ", html.unescape(data)).strip()
        if len(text) >= 2:
            self.parts.append(text)

    def text(self, limit: int = 8000) -> str:
        return " ".join(self.parts)[:limit]


class WebResearchService:
    """Small Windows-friendly web research layer with no API key requirement."""

    SEARCH_URL = "https://html.duckduckgo.com/html/?q={query}"

    def __init__(self, timeout_seconds: float = 8.0) -> None:
        self.timeout_seconds = timeout_seconds
        self.user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/142 Safari/537.36 D.O.N.N.A./0.2"
        )

    def _request(self, url: str, max_bytes: int = 1_000_000) -> tuple[bytes, str]:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.user_agent,
                "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
            },
        )
        with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
            content_type = response.headers.get("Content-Type", "")
            return response.read(max_bytes), content_type

    @staticmethod
    def _decode_search_url(url: str) -> str:
        absolute = urllib.parse.urljoin("https://duckduckgo.com", url)
        parsed = urllib.parse.urlparse(absolute)
        query = urllib.parse.parse_qs(parsed.query)
        target = query.get("uddg", [None])[0]
        return urllib.parse.unquote(target) if target else absolute

    @staticmethod
    def _safe_public_url(url: str) -> bool:
        try:
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                return False
            host = parsed.hostname.lower()
            if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
                return False
            for info in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM):
                address = ipaddress.ip_address(info[4][0])
                if (
                    address.is_private
                    or address.is_loopback
                    or address.is_link_local
                    or address.is_multicast
                    or address.is_reserved
                ):
                    return False
            return True
        except (OSError, ValueError):
            return False

    def available(self) -> bool:
        try:
            body, _ = self._request(
                self.SEARCH_URL.format(query=urllib.parse.quote_plus("teste")),
                max_bytes=16_000,
            )
            return bool(body)
        except Exception:
            return False

    def fetch_page(self, url: str, limit: int = 7000) -> str:
        if not self._safe_public_url(url):
            return ""
        try:
            body, content_type = self._request(url)
        except Exception:
            return ""
        if "text/html" not in content_type.lower() and "text/plain" not in content_type.lower():
            return ""
        encoding_match = re.search(r"charset=([\w-]+)", content_type, re.I)
        encoding = encoding_match.group(1) if encoding_match else "utf-8"
        text = body.decode(encoding, errors="ignore")
        parser = _TextParser()
        try:
            parser.feed(text)
        except Exception:
            return ""
        return parser.text(limit)


    def _wikipedia_search(self, query: str, max_results: int = 2) -> list[ResearchResult]:
        params = urllib.parse.urlencode({
            "action": "query",
            "list": "search",
            "srsearch": query,
            "utf8": "1",
            "format": "json",
        })
        api_url = f"https://pt.wikipedia.org/w/api.php?{params}"
        try:
            body, _ = self._request(api_url, max_bytes=300_000)
            data = __import__("json").loads(body.decode("utf-8", errors="ignore"))
        except Exception:
            return []

        results: list[ResearchResult] = []
        for item in data.get("query", {}).get("search", [])[:max_results]:
            title = str(item.get("title", "")).strip()
            if not title:
                continue
            page_url = "https://pt.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
            excerpt = self.fetch_page(page_url, limit=6000)
            snippet = re.sub(r"<[^>]+>", " ", str(item.get("snippet", "")))
            snippet = re.sub(r"\s+", " ", html.unescape(snippet)).strip()
            results.append(
                ResearchResult(
                    title=f"Wikipedia — {title}",
                    url=page_url,
                    snippet=snippet,
                    page_excerpt=excerpt,
                )
            )
        return results

    def search(self, query: str, max_results: int = 4, fetch_pages: int = 2) -> list[ResearchResult]:
        if not query.strip():
            return []
        url = self.SEARCH_URL.format(query=urllib.parse.quote_plus(query))
        try:
            body, _ = self._request(url)
        except Exception:
            return self._wikipedia_search(query, max_results=min(max_results, 2))

        parser = _SearchParser()
        try:
            parser.feed(body.decode("utf-8", errors="ignore"))
        except Exception:
            return []

        results: list[ResearchResult] = []
        seen: set[str] = set()
        for title, raw_url in parser.results:
            target = self._decode_search_url(raw_url)
            if target in seen or not self._safe_public_url(target):
                continue
            seen.add(target)
            excerpt = self.fetch_page(target) if len(results) < fetch_pages else ""
            snippet = excerpt[:700] if excerpt else ""
            results.append(ResearchResult(title=title, url=target, snippet=snippet, page_excerpt=excerpt))
            if len(results) >= max_results:
                break
        if not results:
            return self._wikipedia_search(query, max_results=min(max_results, 2))
        return results

    @staticmethod
    def prompt_context(results: list[ResearchResult]) -> str:
        if not results:
            return "Nenhuma fonte web pôde ser recuperada agora."
        return "\n\n".join(
            f"[Fonte {index}]\n{result.context()}"
            for index, result in enumerate(results, start=1)
        )

    @staticmethod
    def source_footer(results: list[ResearchResult], limit: int = 4) -> str:
        if not results:
            return ""
        lines = ["Fontes pesquisadas:"]
        for item in results[:limit]:
            lines.append(f"- {item.title}: {item.url}")
        return "\n".join(lines)
