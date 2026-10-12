/** Browser-only guardrail: blocks explicit credential labels from persisted memory. */
export function containsSensitiveMemoryText(value: string): boolean {
  return /(?:senha|password|passphrase|credenciais|api[ _-]*key|access[ _-]*token|private[ _-]*key)/i.test(value.normalize("NFKC"));
}
