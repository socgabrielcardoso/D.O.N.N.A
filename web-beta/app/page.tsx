"use client";

import { FormEvent, useState } from "react";

type Source = { title: string; url: string; excerpt: string };
type Message = {
  role: "user" | "donna";
  text: string;
  sources?: Source[];
  provider?: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "donna",
      text: "D.O.N.N.A. Web Beta online. Pesquisa pública e fallback cloud prontos.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setMessages((current) => [...current, { role: "user", text: message }]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await response.json()) as {
        answer?: string;
        sources?: Source[];
        provider?: string;
      };
      setMessages((current) => [
        ...current,
        {
          role: "donna",
          text: data.answer || "A beta não retornou texto.",
          sources: data.sources ?? [],
          provider: data.provider,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "donna",
          text: `Falha de conexão com a beta: ${String(error)}`,
          provider: "client-error",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <div>
          <h1>D.O.N.N.A.</h1>
          <div className="status">Detectar • Observar • Neutralizar • Nobre • Astuta</div>
        </div>
        <div className="badge">VERCEL WEB BETA</div>
      </header>

      <section className="panel">
        <div className="chat">
          {messages.map((message, index) => (
            <div
              className={`message ${message.role === "user" ? "user" : "donna"}`}
              key={index}
            >
              <strong>{message.role === "user" ? "Gabriel" : "D.O.N.N.A."}</strong>
              {"\n"}
              {message.text}
              {message.sources?.length ? (
                <div className="sources">
                  <div>Fontes:</div>
                  {message.sources.slice(0, 4).map((source) => (
                    <div key={source.url}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    </div>
                  ))}
                </div>
              ) : null}
              {message.provider ? (
                <div className="status">provider: {message.provider}</div>
              ) : null}
            </div>
          ))}
        </div>

        <form onSubmit={submit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Pergunte à D.O.N.N.A.…"
            autoFocus
          />
          <button disabled={loading}>{loading ? "Pesquisando…" : "Enviar"}</button>
        </form>
      </section>
    </main>
  );
}
