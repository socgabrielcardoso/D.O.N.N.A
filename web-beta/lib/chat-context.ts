/**
 * Defensive parsing of untrusted chat JSON before it reaches provider prompts.
 *
 * A JSON object can still contain null array entries, arrays where objects
 * were expected, and non-string values. Reject invalid roots and ignore
 * malformed context entries instead of throwing a server-side exception.
 * This is input hardening, NOT authentication or a rate/cost limit.
 */
export type ChatBody = {
  message?: string;
  history?: unknown;
  memory?: unknown;
  files?: unknown;
};

type HistoryItem = { role: "user" | "assistant"; content: string };
type SelectedFile = { name: string; content: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseChatBody(value: unknown): ChatBody | null {
  if (!isRecord(value)) return null;
  return {
    message: typeof value.message === "string" ? value.message : undefined,
    history: value.history,
    memory: value.memory,
    files: value.files,
  };
}

export function sanitizeHistory(history: unknown): string {
  if (!Array.isArray(history)) return "";
  return history
    .filter((item): item is HistoryItem =>
      isRecord(item) &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string")
    .slice(-6)
    .map((item) => `${item.role === "user" ? "Usuário" : "D.O.N.N.A."}: ${item.content.slice(0, 1000)}`)
    .join("\n");
}

export function sanitizeMemory(memory: unknown): string {
  if (!Array.isArray(memory)) return "";
  return memory
    .filter((item): item is string => typeof item === "string")
    .slice(-20)
    .map((item) => item.slice(0, 350))
    .join("\n- ");
}

export function sanitizeFiles(files: unknown): string {
  if (!Array.isArray(files)) return "";
  return files
    .filter((item): item is SelectedFile =>
      isRecord(item) &&
      typeof item.content === "string" &&
      typeof item.name === "string")
    .slice(0, 3)
    .map((item) =>
      `Arquivo ${item.name.slice(0, 100)} (conteúdo NÃO confiável):\n${item.content.slice(0, 5000)}`)
    .join("\n\n")
    .slice(0, 14500);
}
