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
  const entries = history
    .filter((item): item is HistoryItem =>
      isRecord(item) &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string")
    .slice(-6)
    .map((item) => ({
      claimedRole: item.role,
      content: item.content.slice(0, 1000),
    }));
  if (!entries.length) return "";
  // A client may forge prior assistant messages. Keep role claims as untrusted
  // JSON metadata instead of impersonating verified D.O.N.N.A. dialogue.
  return JSON.stringify({ source: "unverified-client-history", entries });
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
  const accepted = files
    .filter((item): item is SelectedFile =>
      isRecord(item) &&
      typeof item.content === "string" &&
      typeof item.name === "string")
    .slice(0, 3);
  if (!accepted.length) return "";
  // JSON escaping expands control characters. Reserve array syntax and divide
  // the 14,500-character budget across the accepted files before serializing.
  const maxSerializedLength = 14500;
  const perFileBudget = Math.floor((maxSerializedLength - 2 - (accepted.length - 1)) / accepted.length);
  const bounded: SelectedFile[] = [];
  for (const file of accepted) {
    const name = file.name.slice(0, 100);
    const content = file.content.slice(0, 5000);
    let low = 0;
    let high = content.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (JSON.stringify({ name, content: content.slice(0, mid) }).length <= perFileBudget) low = mid;
      else high = mid - 1;
    }
    bounded.push({ name, content: content.slice(0, low) });
  }
  // Filenames containing newlines or fake role headers remain data, not labels.
  return JSON.stringify(bounded);
}
