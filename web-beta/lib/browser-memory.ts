/**
 * Browser-memory safety boundaries.
 *
 * Memory and conversation are session-only by default until an explicitly
 * opted-in, client-side encrypted store with user-controlled keys exists.
 * Regex screening is defense in depth, NOT proof that a note is non-sensitive.
 */
export const LEGACY_BROWSER_STORAGE_KEYS = [
  "donna:web:history",
  "donna:web:memory",
] as const;

const explicitCredentialLabel =
  /(?:senha|senhas|password|passphrase|credenciais|credential|api[ _-]*key|access[ _-]*token|refresh[ _-]*token|secret|segredo|private[ _-]*key|chave[ _-]*privada|bearer|c[oó]digo[ _-]*(?:de[ _-]*)?(?:verifica[cç][aã]o|recupera[cç][aã]o))/iu;

/** Reject likely secrets in explicit memory commands without retaining input. */
export function containsSensitiveMemoryText(value: string): boolean {
  return explicitCredentialLabel.test(value.normalize("NFKC"));
}

export function canRememberNote(value: string): boolean {
  const note = value.trim();
  return note.length > 0 && note.length <= 500 && !containsSensitiveMemoryText(note);
}

/** Enumerate key names only: never load legacy plaintext values. */
export function hasLegacyBrowserStorage(storage: Pick<Storage, "length" | "key">): boolean {
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (name !== null && LEGACY_BROWSER_STORAGE_KEYS.some((key) => key === name)) {
      return true;
    }
  }
  return false;
}

/** Only called by the user-initiated, confirmed browser deletion action. */
export function clearLegacyBrowserStorage(storage: Pick<Storage, "removeItem">): void {
  for (const key of LEGACY_BROWSER_STORAGE_KEYS) storage.removeItem(key);
}

/** Never include memory in requests to model providers without explicit consent. */
export function memoriesForProvider(notes: readonly string[], userConsented: boolean): string[] {
  if (!userConsented) return [];
  return notes.filter(canRememberNote).slice(-20);
}
