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

/**
 * Bound the JSON-escaped payload without splitting Unicode surrogate pairs.
 * The budget excludes the two JSON string quotation marks.
 */
function boundedJsonString(content: string, maxEncodedLength: number): string {
  const points = Array.from(content);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const encodedLength = JSON.stringify(points.slice(0, mid).join("")).length - 2;
    if (encodedLength <= maxEncodedLength) low = mid;
    else high = mid - 1;
  }
  return points.slice(0, low).join("");
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
  // Bound the *serialized* JSON, not just raw text: escaping control characters
  // can expand the payload beyond composeUserPrompt's 6500-character cap.
  // Truncating that JSON later would silently corrupt its provenance envelope.
  const maxSerializedLength = 6500;
  const envelope = { source: "unverified-client-history", entries };
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= maxSerializedLength) return serialized;

  const emptyEntries = entries.map(({ claimedRole }) => ({ claimedRole, content: "" }));
  const overhead = JSON.stringify({ source: envelope.source, entries: emptyEntries }).length;
  const perEntryBudget = Math.floor((maxSerializedLength - overhead) / entries.length);
  const boundedEntries = entries.map(({ claimedRole, content }) => {
    return { claimedRole, content: boundedJsonString(content, perEntryBudget) };
  });
  return JSON.stringify({ source: envelope.source, entries: boundedEntries });
}

export function sanitizeMemory(memory: unknown): string {
  if (!Array.isArray(memory)) return "";
  const entries = memory
    .filter((item): item is string => typeof item === "string")
    .slice(-20)
    .map((item) => Array.from(item).slice(0, 350).join(""));
  if (!entries.length) return "";

  // Client-supplied "memories" are unverified. A newline or fake "- " bullet
  // inside an entry must not impersonate a second memory or an instruction.
  // Keep the complete JSON envelope below the downstream 7500-char limit.
  const maxSerializedLength = 7500;
  const source = "unverified-client-memory";
  const serialized = JSON.stringify({ source, entries });
  if (serialized.length <= maxSerializedLength) return serialized;

  const overhead = JSON.stringify({ source, entries: entries.map(() => "") }).length;
  const perEntryBudget = Math.max(0, Math.floor((maxSerializedLength - overhead) / entries.length));
  const boundedEntries = entries.map((entry) => boundedJsonString(entry, perEntryBudget));
  return JSON.stringify({ source, entries: boundedEntries });
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
    const name = Array.from(file.name).slice(0, 100).join("");
    const content = Array.from(file.content).slice(0, 5000).join("");
    const emptyEntryLength = JSON.stringify({ name, content: "" }).length;
    bounded.push({
      name,
      content: boundedJsonString(content, Math.max(0, perFileBudget - emptyEntryLength)),
    });
  }
  // Filenames containing newlines or fake role headers remain data, not labels.
  return JSON.stringify(bounded);
}
