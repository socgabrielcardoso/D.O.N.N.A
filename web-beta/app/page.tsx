"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Source = { title: string; url: string; excerpt?: string };
type Message = {
  role: "user" | "donna" | "system";
  text: string;
  sources?: Source[];
  provider?: string;
  at?: number;
};

type NativeResponse = {
  text: string;
  state?: string;
  metadata?: {
    provider?: string;
    sources?: Source[];
    researched?: boolean;
    memory_used?: boolean;
    [key: string]: unknown;
  };
};

type FileItem = {
  name: string;
  path: string;
  ext?: string;
  size?: number;
  modified?: number;
};

type ScriptItem = {
  name: string;
  path: string;
  kind?: string;
};

type ProcessItem = {
  pid: number;
  name: string;
  memory: number;
};

type NativeSnapshot = {
  native: boolean;
  timestamp: number;
  system: {
    cpu: number;
    memory: number;
    disk: number;
    host: string;
    os: string;
  };
  memory: {
    memories: number;
    conversation_turns: number;
  };
  files: FileItem[];
  scripts: ScriptItem[];
  processes: ProcessItem[];
  tools: string[];
  mode: string;
};

type NativeApi = {
  ping(): Promise<{ ok: boolean; native: boolean; platform: string; mode: string; version: string }>;
  ask(text: string): Promise<NativeResponse>;
  listen(): Promise<{ ok: boolean; text: string; engine: string; error?: string }>;
  speak(text: string): Promise<{ ok: boolean; engine: string; error?: string }>;
  stop_speaking(): Promise<{ ok: boolean }>;
  cancel(): Promise<{ ok: boolean }>;
  open_app(app: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  open_path(path: string): Promise<{ ok: boolean; error?: string }>;
  snapshot(): Promise<NativeSnapshot>;
  health(): Promise<{ text: string; metadata?: Record<string, unknown> }>;
};

type DonnaWindow = Window & {
  pywebview?: { api: NativeApi };
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
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

type DonnaState = "idle" | "listening" | "thinking" | "speaking" | "error";

const CLOUD_URL = "/api/chat";

function cleanSpeech(text: string): string {
  return text
    .split("\n\nFontes pesquisadas:", 1)[0]
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*#_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBytes(value?: number): string {
  if (!value || value < 1024) return `${value ?? 0} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

function stateLabel(state: DonnaState): string {
  switch (state) {
    case "listening":
      return "LISTENING";
    case "thinking":
      return "THINKING";
    case "speaking":
      return "SPEAKING";
    case "error":
      return "ERROR";
    default:
      return "STANDBY";
  }
}

function Orb({ state }: { state: DonnaState }) {
  return (
    <div className={`orb-shell state-${state}`} aria-label={`D.O.N.N.A. ${stateLabel(state)}`}>
      <div className="orbit orbit-a" />
      <div className="orbit orbit-b" />
      <div className="orbit orbit-c" />
      <div className="orb-wave wave-a" />
      <div className="orb-wave wave-b" />
      <div className="orb-core">
        <div className="orb-eye" />
        <span>D</span>
      </div>
      <div className="orb-state">{stateLabel(state)}</div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "donna",
      text: "Cockpit online. Boa noite, Chefe.",
      provider: "boot",
      at: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<DonnaState>("idle");
  const [native, setNative] = useState(false);
  const [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [statusText, setStatusText] = useState("Inicializando cockpit...");
  const [panel, setPanel] = useState<"activity" | "memory" | "system">("activity");
  const [commandPalette, setCommandPalette] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const stateRef = useRef<DonnaState>("idle");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("donna:web:history");
      if (saved) {
        const parsed = JSON.parse(saved) as Message[];
        if (Array.isArray(parsed) && parsed.length) {
          setMessages(parsed.slice(-30));
        }
      }
      const speak = window.localStorage.getItem("donna:autoSpeak");
      if (speak !== null) setAutoSpeak(speak === "1");
    } catch {
      // Storage is optional.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("donna:web:history", JSON.stringify(messages.slice(-30)));
    } catch {
      // Ignore storage failures.
    }
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      window.localStorage.setItem("donna:autoSpeak", autoSpeak ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, [autoSpeak]);

  const getNativeApi = useCallback((): NativeApi | null => {
    return (window as DonnaWindow).pywebview?.api ?? null;
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const api = getNativeApi();
    if (!api) return;
    try {
      const next = await api.snapshot();
      setSnapshot(next);
      setNative(true);
      setStatusText(`LOCAL BRIDGE • ${next.system.host} • ${next.mode}`);
    } catch {
      setNative(false);
    }
  }, [getNativeApi]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const detect = async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
        const api = getNativeApi();
        if (api) {
          try {
            const pong = await api.ping();
            if (pong.native) {
              setNative(true);
              setStatusText(`WINDOWS NATIVE • ${pong.mode} • v${pong.version}`);
              await refreshSnapshot();
              timer = setInterval(refreshSnapshot, 6000);
              return;
            }
          } catch {
            // pywebview may not have injected the API yet.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      if (!cancelled) {
        setNative(false);
        setStatusText("VERCEL CLOUD • WEB MODE");
      }
    };

    detect();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [getNativeApi, refreshSnapshot]);

  const browserSpeak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanSpeech(text));
    utterance.lang = "pt-BR";
    utterance.rate = 1.03;
    utterance.pitch = 1.04;

    const chooseVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const ranked = voices
        .map((voice) => {
          const id = `${voice.name} ${voice.lang}`.toLowerCase();
          let score = 0;
          if (voice.lang.toLowerCase().startsWith("pt-br")) score += 10;
          if (id.includes("francisca")) score += 8;
          if (id.includes("maria")) score += 7;
          if (id.includes("female")) score += 5;
          if (id.includes("google português")) score += 4;
          return { voice, score };
        })
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score) utterance.voice = ranked[0].voice;
    };

    chooseVoice();
    utterance.onstart = () => setState("speaking");
    utterance.onend = () => setState("idle");
    utterance.onerror = () => setState("idle");
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceEnabled || !text.trim()) return;

      const api = getNativeApi();
      if (api) {
        setState("speaking");
        try {
          await api.speak(cleanSpeech(text));
        } finally {
          setState("idle");
        }
        return;
      }

      browserSpeak(text);
    },
    [browserSpeak, getNativeApi, voiceEnabled],
  );

  const pushDonna = useCallback(
    async (answer: string, provider: string, sources: Source[] = []) => {
      setMessages((current) => [
        ...current,
        { role: "donna", text: answer, provider, sources, at: Date.now() },
      ]);
      if (autoSpeak) await speak(answer);
      else setState("idle");
    },
    [autoSpeak, speak],
  );

  const ask = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || stateRef.current === "thinking") return;

      setMessages((current) => [
        ...current,
        { role: "user", text: message, provider: native ? "local-input" : "web-input", at: Date.now() },
      ]);
      setInput("");
      setState("thinking");
      setStatusText(native ? "LOCAL • MEMÓRIA → WEB → MODELO" : "CLOUD • RESEARCH → GATEWAY");

      try {
        const api = getNativeApi();
        if (api) {
          const result = await api.ask(message);
          const sources = Array.isArray(result.metadata?.sources)
            ? (result.metadata?.sources as Source[])
            : [];
          const provider = String(result.metadata?.provider ?? "local");
          await pushDonna(result.text, provider, sources);
          await refreshSnapshot();
          return;
        }

        const history = messages
          .filter((item) => item.role === "user" || item.role === "donna")
          .slice(-10)
          .map((item) => ({
            role: item.role === "donna" ? "assistant" : "user",
            content: item.text,
          }));

        const response = await fetch(CLOUD_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
        });
        const data = (await response.json()) as {
          answer?: string;
          sources?: Source[];
          provider?: string;
        };

        if (!response.ok) {
          throw new Error(data.answer || `HTTP ${response.status}`);
        }

        await pushDonna(
          data.answer || "A camada cloud não retornou texto.",
          data.provider || "cloud",
          data.sources ?? [],
        );
      } catch (error) {
        const text = `Falha na rota ativa: ${error instanceof Error ? error.message : String(error)}`;
        setMessages((current) => [
          ...current,
          { role: "system", text, provider: "error", at: Date.now() },
        ]);
        setState("error");
        setTimeout(() => setState("idle"), 1600);
      }
    },
    [getNativeApi, messages, native, pushDonna, refreshSnapshot],
  );

  const listen = useCallback(async () => {
    if (stateRef.current === "thinking") return;

    const api = getNativeApi();
    if (api) {
      setState("listening");
      setStatusText("OUVINDO • WINDOWS HYBRID STT");
      try {
        const result = await api.listen();
        if (result.ok && result.text.trim()) {
          setStatusText(`STT • ${result.engine}`);
          await ask(result.text);
        } else {
          setMessages((current) => [
            ...current,
            {
              role: "system",
              text: result.error || "Não consegui reconhecer sua fala.",
              provider: result.engine,
              at: Date.now(),
            },
          ]);
          setState("idle");
        }
      } catch (error) {
        setStatusText("STT LOCAL FALHOU");
        setState("error");
      }
      return;
    }

    const Donna = window as DonnaWindow;
    const Recognition = Donna.SpeechRecognition || Donna.webkitSpeechRecognition;
    if (!Recognition) {
      setMessages((current) => [
        ...current,
        {
          role: "system",
          text: "Este navegador não expôs SpeechRecognition. Abra pelo cliente Windows para STT híbrido completo.",
          provider: "browser",
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
    setStatusText("OUVINDO • BROWSER STT");

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
      if (text) void ask(text);
      else setState("idle");
    };
    recognition.onerror = (event) => {
      setStatusText(`STT ERROR • ${event.error}`);
      setState("error");
      setTimeout(() => setState("idle"), 1400);
    };
    recognition.onend = () => {
      if (stateRef.current === "listening") setState("idle");
    };
    recognition.start();
  }, [ask, getNativeApi]);

  const cancel = useCallback(async () => {
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
    const api = getNativeApi();
    if (api) await api.cancel();
    setState("idle");
    setStatusText(native ? "LOCAL BRIDGE • CANCELADO" : "WEB MODE • CANCELADO");
  }, [getNativeApi, native]);

  const openApp = useCallback(
    async (app: string) => {
      const api = getNativeApi();
      if (!api) {
        setMessages((current) => [
          ...current,
          {
            role: "system",
            text: "Ferramentas do Windows só ficam disponíveis dentro do cliente D.O.N.N.A. local.",
            provider: "security-boundary",
            at: Date.now(),
          },
        ]);
        return;
      }
      const result = await api.open_app(app);
      setMessages((current) => [
        ...current,
        {
          role: "system",
          text: result.text || result.error || `Ação enviada: ${app}`,
          provider: "windows-tool",
          at: Date.now(),
        },
      ]);
    },
    [getNativeApi],
  );

  const openPath = useCallback(
    async (path: string) => {
      const api = getNativeApi();
      if (!api) return;
      await api.open_path(path);
    },
    [getNativeApi],
  );

  const diagnose = useCallback(async () => {
    const api = getNativeApi();
    if (!api) {
      const response = await fetch("/api/health");
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
      return;
    }

    setState("thinking");
    const result = await api.health();
    setMessages((current) => [
      ...current,
      {
        role: "system",
        text: result.text,
        provider: "native-health",
        at: Date.now(),
      },
    ]);
    setState("idle");
    await refreshSnapshot();
  }, [getNativeApi, refreshSnapshot]);

  const floating = useMemo(() => {
    if (!snapshot) return [];
    return [
      ...snapshot.files.slice(0, 5).map((item) => ({
        type: "FILE",
        label: item.name,
        sub: formatBytes(item.size),
        path: item.path,
      })),
      ...snapshot.scripts.slice(0, 5).map((item) => ({
        type: "SCRIPT",
        label: item.name,
        sub: item.kind?.toUpperCase() || "CODE",
        path: item.path,
      })),
    ].slice(0, 10);
  }, [snapshot]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await ask(input);
  }

  return (
    <main className="cockpit">
      <div className="scanlines" aria-hidden="true" />
      <div className="grid-floor" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <h1>D.O.N.N.A.</h1>
            <p>Detectar • Observar • Neutralizar • Nobre • Astuta</p>
          </div>
        </div>

        <div className="top-status">
          <span className={`connection-dot ${native ? "local" : "cloud"}`} />
          <strong>{native ? "WINDOWS NATIVE" : "VERCEL CLOUD"}</strong>
          <span>{statusText}</span>
        </div>

        <div className="top-actions">
          <button className="ghost-button" onClick={() => setCommandPalette((value) => !value)}>
            ⌘ TOOLS
          </button>
          <button className="ghost-button" onClick={diagnose}>
            ◉ DIAG
          </button>
        </div>
      </header>

      <section className="layout">
        <aside className="rail left-rail">
          <div className="rail-title">SYSTEM</div>
          <Stat label="CPU" value={snapshot ? `${snapshot.system.cpu}%` : "—"} />
          <Stat label="RAM" value={snapshot ? `${snapshot.system.memory}%` : "—"} />
          <Stat label="DISK" value={snapshot ? `${snapshot.system.disk}%` : "—"} />
          <Stat label="MODE" value={snapshot?.mode || (native ? "NORMAL" : "CLOUD")} />
          <div className="divider" />
          <div className="rail-title">MEMORY</div>
          <Stat label="FACTS" value={snapshot ? String(snapshot.memory.memories) : "WEB"} />
          <Stat label="TURNS" value={snapshot ? String(snapshot.memory.conversation_turns) : String(messages.length)} />
          <div className="divider" />
          <div className="rail-title">VOICE</div>
          <label className="switch-row">
            <span>VOICE OUT</span>
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
            />
          </label>
          <label className="switch-row">
            <span>AUTO SPEAK</span>
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(event) => setAutoSpeak(event.target.checked)}
            />
          </label>
        </aside>

        <section className="core-stage">
          <div className="hud-circle hud-circle-1" aria-hidden="true" />
          <div className="hud-circle hud-circle-2" aria-hidden="true" />
          <div className="hud-circle hud-circle-3" aria-hidden="true" />

          {native &&
            floating.map((item, index) => (
              <button
                className={`float-node node-${index}`}
                key={`${item.path}-${index}`}
                onClick={() => openPath(item.path)}
                title={item.path}
              >
                <span className="float-type">{item.type}</span>
                <strong>{item.label}</strong>
                <small>{item.sub}</small>
              </button>
            ))}

          <Orb state={state} />

          <div className="core-readout">
            <span>{native ? "LOCAL INTELLIGENCE ONLINE" : "CLOUD INTELLIGENCE ONLINE"}</span>
            <strong>{stateLabel(state)}</strong>
          </div>

          {native && snapshot?.processes?.length ? (
            <div className="process-ring">
              {snapshot.processes.slice(0, 8).map((proc, index) => (
                <span key={proc.pid} className={`process-chip process-${index}`}>
                  {proc.name.replace(".exe", "")} <b>{proc.memory.toFixed(1)}%</b>
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="rail right-rail">
          <div className="tabs">
            <button className={panel === "activity" ? "active" : ""} onClick={() => setPanel("activity")}>
              ACTIVITY
            </button>
            <button className={panel === "memory" ? "active" : ""} onClick={() => setPanel("memory")}>
              MEMORY
            </button>
            <button className={panel === "system" ? "active" : ""} onClick={() => setPanel("system")}>
              TOOLS
            </button>
          </div>

          {panel === "activity" && (
            <div className="activity-list">
              {messages
                .slice(-8)
                .reverse()
                .map((message, index) => (
                  <div className={`activity ${message.role}`} key={`${message.at}-${index}`}>
                    <span>{message.role === "donna" ? "DONNA" : message.role.toUpperCase()}</span>
                    <p>{message.text.slice(0, 150)}</p>
                    <small>{message.provider || "local"}</small>
                  </div>
                ))}
            </div>
          )}

          {panel === "memory" && (
            <div className="memory-panel">
              <div className="memory-orb">
                <strong>{snapshot?.memory.memories ?? 0}</strong>
                <span>persistent facts</span>
              </div>
              <div className="memory-orb">
                <strong>{snapshot?.memory.conversation_turns ?? messages.length}</strong>
                <span>conversation turns</span>
              </div>
              <p>
                {native
                  ? "Memória privada permanece no SQLite local do Windows."
                  : "Web mode mantém apenas histórico local do navegador."}
              </p>
            </div>
          )}

          {panel === "system" && (
            <div className="tool-grid">
              {["Chrome", "Brave", "VS Code", "Explorer", "Defender"].map((app) => (
                <button key={app} disabled={!native} onClick={() => openApp(app)}>
                  <span>↗</span>
                  {app}
                </button>
              ))}
              <button onClick={diagnose}>
                <span>◉</span>
                Diagnose
              </button>
            </div>
          )}
        </aside>
      </section>

      <section className="conversation-deck">
        <div className="chat-stream" ref={chatRef}>
          {messages.slice(-12).map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.at}-${index}`}>
              <div className="message-head">
                <strong>{message.role === "donna" ? "D.O.N.N.A." : message.role === "user" ? "GABRIEL" : "SYSTEM"}</strong>
                <span>{message.provider || "local"}</span>
              </div>
              <p>{message.text}</p>
              {message.sources?.length ? (
                <div className="source-row">
                  {message.sources.slice(0, 4).map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                      {source.title}
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <form className="command-bar" onSubmit={submit}>
          <button
            type="button"
            className={`mic-button ${state === "listening" ? "active" : ""}`}
            onClick={listen}
            aria-label="Ouvir"
          >
            ◉
          </button>
          <div className="command-input">
            <span>DONNA //</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={native ? "Comande o Windows ou faça uma pergunta…" : "Pesquise, pergunte, investigue…"}
              autoFocus
            />
          </div>
          <button className="send-button" disabled={state === "thinking" || !input.trim()}>
            {state === "thinking" ? "PROCESSING" : "EXECUTE"}
          </button>
          <button type="button" className="cancel-button" onClick={cancel}>
            ×
          </button>
        </form>
      </section>

      {commandPalette && (
        <div className="palette-backdrop" onClick={() => setCommandPalette(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <div className="palette-head">
              <strong>WINDOWS TOOL MATRIX</strong>
              <button onClick={() => setCommandPalette(false)}>×</button>
            </div>
            <div className="palette-grid">
              {(snapshot?.tools ?? ["web research", "cloud chat"]).map((tool) => (
                <button
                  key={tool}
                  onClick={() => {
                    setInput(`Donna, use ${tool} para `);
                    setCommandPalette(false);
                  }}
                >
                  <span>TOOL</span>
                  {tool.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer>
        <span>D.O.N.N.A. CORE v0.3</span>
        <span>{native ? "PRIVATE MEMORY • LOCAL TOOLS • OLLAMA • WEB" : "VERCEL • AI GATEWAY • WEB RESEARCH"}</span>
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
