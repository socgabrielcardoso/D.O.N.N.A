"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Source = { title: string; url: string; excerpt?: string };
type Message = {
  role: "user" | "donna" | "system";
  text: string;
  sources?: Source[];
  provider?: string;
  at: number;
};
type DonnaState = "idle" | "listening" | "thinking" | "speaking" | "error";
type SelectedAsset = {
  name: string;
  size: number;
  kind: "FILE" | "SCRIPT";
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

function label(state: DonnaState) {
  return state === "idle" ? "STANDBY" : state.toUpperCase();
}

function cleanSpeech(text: string) {
  return text
    .split("\n\nFontes", 1)[0]
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*#_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function Orb({ state }: { state: DonnaState }) {
  return (
    <div className={`orb-shell state-${state}`}>
      <div className="orbit orbit-a" />
      <div className="orbit orbit-b" />
      <div className="orbit orbit-c" />
      <div className="orb-wave wave-a" />
      <div className="orb-wave wave-b" />
      <div className="orb-core">
        <div className="orb-eye" />
        <span>D</span>
      </div>
      <div className="orb-state">{label(state)}</div>
    </div>
  );
}

export default function Cockpit() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "donna", text: "Cockpit online. Boa noite, Chefe.", provider: "boot", at: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<DonnaState>("idle");
  const [status, setStatus] = useState("VERCEL CLOUD • ONLINE");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [memories, setMemories] = useState<string[]>([]);
  const [assets, setAssets] = useState<SelectedAsset[]>([]);
  const [panel, setPanel] = useState<"activity" | "memory" | "tools">("activity");
  const [palette, setPalette] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem("donna:web:history");
      const storedMemory = localStorage.getItem("donna:web:memory");
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory) as Message[];
        if (Array.isArray(parsed) && parsed.length) setMessages(parsed.slice(-30));
      }
      if (storedMemory) {
        const parsed = JSON.parse(storedMemory) as string[];
        if (Array.isArray(parsed)) setMemories(parsed.slice(-40));
      }
    } catch {
      // Browser storage is optional.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("donna:web:history", JSON.stringify(messages.slice(-30)));
      localStorage.setItem("donna:web:memory", JSON.stringify(memories.slice(-40)));
    } catch {
      // Ignore storage failures.
    }
  }, [messages, memories]);

  const speak = useCallback(
    (text: string) => {
      if (!voiceEnabled || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(cleanSpeech(text));
      utterance.lang = "pt-BR";
      utterance.rate = 1.02;
      utterance.pitch = 1.05;

      const voices = window.speechSynthesis.getVoices();
      const ranked = voices
        .map((voice) => {
          const id = `${voice.name} ${voice.lang}`.toLowerCase();
          let score = 0;
          if (voice.lang.toLowerCase().startsWith("pt-br")) score += 10;
          if (id.includes("francisca")) score += 8;
          if (id.includes("maria")) score += 7;
          if (id.includes("female")) score += 5;
          return { voice, score };
        })
        .sort((a, b) => b.score - a.score);

      if (ranked[0]?.score) utterance.voice = ranked[0].voice;
      utterance.onstart = () => setState("speaking");
      utterance.onend = () => setState("idle");
      utterance.onerror = () => setState("idle");
      window.speechSynthesis.speak(utterance);
    },
    [voiceEnabled],
  );

  const respond = useCallback(
    (text: string, provider: string, sources: Source[] = []) => {
      setMessages((current) => [
        ...current,
        { role: "donna", text, provider, sources, at: Date.now() },
      ]);
      if (autoSpeak) speak(text);
      else setState("idle");
    },
    [autoSpeak, speak],
  );

  const localMemoryCommand = useCallback(
    (text: string) => {
      const low = text.toLowerCase().trim();

      if (low.startsWith("lembre que ") || low.startsWith("lembre ")) {
        const note = text.replace(/^lembre( que)?\s+/i, "").trim();
        if (!note) return false;
        setMemories((current) => [...new Set([...current, note])].slice(-40));
        respond(`Memória salva neste navegador: ${note}`, "browser-memory");
        return true;
      }

      if (low.startsWith("esqueça ") || low.startsWith("esqueca ")) {
        const term = text.replace(/^esque[çc]a\s+/i, "").trim().toLowerCase();
        setMemories((current) => current.filter((item) => !item.toLowerCase().includes(term)));
        respond("Removi as memórias correspondentes deste navegador.", "browser-memory");
        return true;
      }

      if (low.includes("o que você lembra") || low.includes("o que voce lembra")) {
        respond(
          memories.length
            ? memories.map((item, index) => `${index + 1}. ${item}`).join("\n")
            : "Ainda não há memórias explícitas neste navegador.",
          "browser-memory",
        );
        return true;
      }

      return false;
    },
    [memories, respond],
  );

  const ask = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || state === "thinking") return;

      setMessages((current) => [
        ...current,
        { role: "user", text: message, provider: "web-input", at: Date.now() },
      ]);
      setInput("");

      if (localMemoryCommand(message)) return;

      setState("thinking");
      setStatus("WEB RESEARCH → AI GATEWAY → FALLBACK");

      try {
        const history = messages
          .filter((item) => item.role === "user" || item.role === "donna")
          .slice(-10)
          .map((item) => ({
            role: item.role === "donna" ? "assistant" : "user",
            content: item.text,
          }));

        const contextualMessage = memories.length
          ? `${message}\n\nContexto de memória do usuário:\n- ${memories.slice(-20).join("\n- ")}`
          : message;

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: contextualMessage, history }),
        });

        const data = (await response.json()) as {
          answer?: string;
          sources?: Source[];
          provider?: string;
        };

        if (!response.ok) throw new Error(data.answer || `HTTP ${response.status}`);

        respond(
          data.answer || "A camada cloud não retornou texto.",
          data.provider || "cloud",
          data.sources ?? [],
        );
        setStatus(`VERCEL CLOUD • ${data.provider || "ONLINE"}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setMessages((current) => [
          ...current,
          { role: "system", text: `Falha cloud: ${detail}`, provider: "error", at: Date.now() },
        ]);
        setState("error");
        setTimeout(() => setState("idle"), 1400);
      }
    },
    [localMemoryCommand, memories, messages, respond, state],
  );

  const listen = useCallback(() => {
    const Donna = window as SpeechWindow;
    const Recognition = Donna.SpeechRecognition || Donna.webkitSpeechRecognition;
    if (!Recognition) {
      setMessages((current) => [
        ...current,
        {
          role: "system",
          text: "Use Edge ou Chrome para reconhecimento de voz web.",
          provider: "browser-stt",
          at: Date.now(),
        },
      ]);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    setState("listening");
    setStatus("OUVINDO • BROWSER STT");

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
      if (text) void ask(text);
      else setState("idle");
    };
    recognition.onerror = (event) => {
      setStatus(`STT ERROR • ${event.error}`);
      setState("error");
      setTimeout(() => setState("idle"), 1200);
    };
    recognition.onend = () => {
      setState((current) => (current === "listening" ? "idle" : current));
    };
    recognition.start();
  }, [ask]);

  const cancel = useCallback(() => {
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
    setState("idle");
    setStatus("VERCEL CLOUD • CANCELADO");
  }, []);

  const importFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const scriptExts = new Set(["py", "ps1", "js", "ts", "tsx", "sh", "bat", "cmd"]);
    const next = Array.from(files)
      .slice(0, 30)
      .map((file) => {
        const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
        return {
          name: file.name,
          size: file.size,
          kind: scriptExts.has(ext) ? ("SCRIPT" as const) : ("FILE" as const),
        };
      });
    setAssets(next);
    setMessages((current) => [
      ...current,
      {
        role: "system",
        text: `${next.length} arquivos selecionados para visualização local no cockpit.`,
        provider: "browser-files",
        at: Date.now(),
      },
    ]);
  }, []);

  const diagnose = useCallback(async () => {
    setState("thinking");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const data = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "system",
          text: `Cloud health: ${JSON.stringify(data)}`,
          provider: "vercel-health",
          at: Date.now(),
        },
      ]);
    } finally {
      setState("idle");
    }
  }, []);

  const floating = useMemo(() => assets.slice(0, 10), [assets]);
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await ask(input);
  }

  return (
    <main className="cockpit">
      <div className="scanlines" />
      <div className="grid-floor" />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <h1>D.O.N.N.A.</h1>
            <p>Detectar • Observar • Neutralizar • Nobre • Astuta</p>
          </div>
        </div>

        <div className="top-status">
          <span className="connection-dot cloud" />
          <strong>VERCEL CLOUD</strong>
          <span>{status}</span>
        </div>

        <div className="top-actions">
          <input ref={fileRef} type="file" multiple hidden onChange={(event) => importFiles(event.target.files)} />
          <button className="ghost-button" onClick={() => fileRef.current?.click()}>▣ FILES</button>
          <button className="ghost-button" onClick={() => setPalette((value) => !value)}>⌘ TOOLS</button>
          <button className="ghost-button" onClick={diagnose}>◉ DIAG</button>
        </div>
      </header>

      <section className="layout">
        <aside className="rail left-rail">
          <div className="rail-title">CLIENT</div>
          <Stat label="CORES" value={cores ? String(cores) : "—"} />
          <Stat label="FILES" value={String(assets.length)} />
          <Stat label="MEMORY" value={String(memories.length)} />
          <Stat label="MODE" value="CLOUD" />
          <div className="divider" />
          <div className="rail-title">VOICE</div>
          <label className="switch-row">
            <span>VOICE OUT</span>
            <input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} />
          </label>
          <label className="switch-row">
            <span>AUTO SPEAK</span>
            <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
          </label>
        </aside>

        <section className="core-stage">
          <div className="hud-circle hud-circle-1" />
          <div className="hud-circle hud-circle-2" />
          <div className="hud-circle hud-circle-3" />

          {floating.map((asset, index) => (
            <button
              className={`float-node node-${index}`}
              key={`${asset.name}-${index}`}
              onClick={() =>
                setMessages((current) => [
                  ...current,
                  {
                    role: "system",
                    text: `${asset.kind}: ${asset.name} • ${sizeLabel(asset.size)}`,
                    provider: "browser-files",
                    at: Date.now(),
                  },
                ])
              }
            >
              <span className="float-type">{asset.kind}</span>
              <strong>{asset.name}</strong>
              <small>{sizeLabel(asset.size)}</small>
            </button>
          ))}

          <Orb state={state} />

          <div className="core-readout">
            <span>VERCEL AI + WEB RESEARCH ONLINE</span>
            <strong>{label(state)}</strong>
          </div>

          {assets.length ? (
            <div className="process-ring">
              <span className="process-chip process-0">FILES <b>{assets.length}</b></span>
              <span className="process-chip process-1">SCRIPTS <b>{assets.filter((item) => item.kind === "SCRIPT").length}</b></span>
              <span className="process-chip process-2">MEMORY <b>{memories.length}</b></span>
              <span className="process-chip process-3">VOICE <b>{voiceEnabled ? "ON" : "OFF"}</b></span>
            </div>
          ) : null}
        </section>

        <aside className="rail right-rail">
          <div className="tabs">
            <button className={panel === "activity" ? "active" : ""} onClick={() => setPanel("activity")}>ACTIVITY</button>
            <button className={panel === "memory" ? "active" : ""} onClick={() => setPanel("memory")}>MEMORY</button>
            <button className={panel === "tools" ? "active" : ""} onClick={() => setPanel("tools")}>TOOLS</button>
          </div>

          {panel === "activity" && (
            <div className="activity-list">
              {messages.slice(-8).reverse().map((message, index) => (
                <div className={`activity ${message.role}`} key={`${message.at}-${index}`}>
                  <span>{message.role === "donna" ? "DONNA" : message.role.toUpperCase()}</span>
                  <p>{message.text.slice(0, 150)}</p>
                  <small>{message.provider || "cloud"}</small>
                </div>
              ))}
            </div>
          )}

          {panel === "memory" && (
            <div className="memory-panel">
              <div className="memory-orb"><strong>{memories.length}</strong><span>browser facts</span></div>
              <div className="memory-orb"><strong>{messages.length}</strong><span>conversation items</span></div>
              <p>Use “Lembre que...” para criar memória persistente apenas neste navegador.</p>
            </div>
          )}

          {panel === "tools" && (
            <div className="tool-grid">
              <button onClick={() => fileRef.current?.click()}><span>▣</span>Select Files</button>
              <button onClick={listen}><span>◉</span>Voice Input</button>
              <button onClick={diagnose}><span>◎</span>Cloud Health</button>
              <button onClick={() => setInput("Donna, pesquise na internet ")}><span>⌕</span>Research</button>
              <button onClick={() => setInput("Lembre que ")}><span>◇</span>Remember</button>
              <button onClick={() => setInput("Donna, analise ")}><span>△</span>Analyze</button>
            </div>
          )}
        </aside>
      </section>

      <section className="conversation-deck">
        <div className="chat-stream">
          {messages.slice(-12).map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.at}-${index}`}>
              <div className="message-head">
                <strong>{message.role === "donna" ? "D.O.N.N.A." : message.role === "user" ? "GABRIEL" : "SYSTEM"}</strong>
                <span>{message.provider || "cloud"}</span>
              </div>
              <p>{message.text}</p>
              {message.sources?.length ? (
                <div className="source-row">
                  {message.sources.slice(0, 4).map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.title}</a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <form className="command-bar" onSubmit={submit}>
          <button type="button" className={`mic-button ${state === "listening" ? "active" : ""}`} onClick={listen}>◉</button>
          <div className="command-input">
            <span>DONNA //</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pesquise, pergunte, investigue…" autoFocus />
          </div>
          <button className="send-button" disabled={state === "thinking" || !input.trim()}>
            {state === "thinking" ? "PROCESSING" : "EXECUTE"}
          </button>
          <button type="button" className="cancel-button" onClick={cancel}>×</button>
        </form>
      </section>

      {palette && (
        <div className="palette-backdrop" onClick={() => setPalette(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <div className="palette-head">
              <strong>CLOUD TOOL MATRIX</strong>
              <button onClick={() => setPalette(false)}>×</button>
            </div>
            <div className="palette-grid">
              {["web research", "analyze", "remember", "forget", "select files", "voice input", "cloud health", "sources"].map((tool) => (
                <button
                  key={tool}
                  onClick={() => {
                    setInput(`Donna, ${tool} `);
                    setPalette(false);
                  }}
                >
                  <span>TOOL</span>
                  {tool}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer>
        <span>D.O.N.N.A. CLOUD v0.3</span>
        <span>VERCEL • AI GATEWAY • WEB RESEARCH • BROWSER MEMORY • VOICE</span>
        <span>SECURITY BOUNDARY ACTIVE</span>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
