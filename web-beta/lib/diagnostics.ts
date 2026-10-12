/**
 * Bounded, provider-aware inference diagnostics.
 * A successful HTTP request is NOT proof that a language model generated the
 * expected answer. Never return SDK response bodies or credentials to clients.
 */
export type ProbeStatus =
  | "success"
  | "ACCOUNT_VERIFICATION_REQUIRED"
  | "GATEWAY_CREDITS"
  | "GATEWAY_RATE_LIMIT"
  | "GATEWAY_AUTH"
  | "GATEWAY_MODEL"
  | "GATEWAY_NETWORK"
  | "UNEXPECTED_ANSWER"
  | "PROVIDER_ERROR";

export type ProbeCandidate = {
  provider: string;
  run: () => Promise<string>;
};

export type ProbeAttempt = {
  provider: string;
  status: ProbeStatus;
};

export type DiagnosticResult = {
  inferenceVerified: boolean;
  testStatus: ProbeStatus;
  provider: string;
  message: string;
  attempts: ProbeAttempt[];
};

const PERMANENT_GATEWAY_FAILURES = new Set<ProbeStatus>([
  "ACCOUNT_VERIFICATION_REQUIRED",
  "GATEWAY_CREDITS",
  "GATEWAY_AUTH",
]);

export function gatewayCandidates(primary?: string): string[] {
  return [...new Set([
    primary || "openai/gpt-5.4-mini",
    "google/gemini-2.5-flash-lite",
    "openai/gpt-5.4-nano",
  ])];
}

export function matchesProbeAnswer(answer: string): boolean {
  return /^DONNA_OK[.!]?$/i.test(answer.trim().replace(/^["'`]+|["'`]+$/g, "").trim());
}

export function classifyProbeFailure(error: unknown): ProbeStatus {
  const value = typeof error === "object" && error !== null
    ? error as { statusCode?: number; status?: number; message?: string; responseBody?: string }
    : {};
  // Never log, return or expose detail; inspect only to map a safe status code.
  const detail = [value.message ?? String(error), value.responseBody ?? ""].join(" ");
  const status = value.statusCode ?? value.status;
  if (/customer_verification_required|payment.method.*(verify|required)|verification.*required/i.test(detail)) {
    return "ACCOUNT_VERIFICATION_REQUIRED";
  }
  if (status === 402 || /insufficient.*(credit|balance)|credits?_exhausted|payment_required|quota_exceeded/i.test(detail)) {
    return "GATEWAY_CREDITS";
  }
  if (status === 429 || /rate.limit|too.many.requests/i.test(detail)) {
    return "GATEWAY_RATE_LIMIT";
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid.*(token|key)|authentication/i.test(detail)) {
    return "GATEWAY_AUTH";
  }
  if (status === 404 || /model.*(not.found|invalid|not supported)|unsupported.*model/i.test(detail)) {
    return "GATEWAY_MODEL";
  }
  if ([502, 503, 504].includes(status ?? 0) || /timeout|aborted|aborterror|fetch failed/i.test(detail)) {
    return "GATEWAY_NETWORK";
  }
  return "PROVIDER_ERROR";
}

function statusMessage(status: ProbeStatus): string {
  switch (status) {
    case "ACCOUNT_VERIFICATION_REQUIRED":
      return "A conta do Gateway requer verificação; provedores alternativos também foram avaliados quando configurados.";
    case "GATEWAY_CREDITS":
      return "O Gateway não possui créditos disponíveis; alternativas independentes foram avaliadas quando configuradas.";
    case "GATEWAY_AUTH":
      return "O Gateway recusou a autenticação; confira as credenciais sem compartilhá-las.";
    case "GATEWAY_RATE_LIMIT":
      return "Os provedores consultados não confirmaram geração de texto; um limite de requisições foi detectado.";
    case "GATEWAY_MODEL":
      return "Nenhum dos modelos consultados comprovou geração de texto.";
    case "GATEWAY_NETWORK":
      return "Não foi possível confirmar a inferência por falha de comunicação.";
    case "UNEXPECTED_ANSWER":
      return "Um provedor respondeu, mas não retornou o marcador de teste esperado.";
    default:
      return "Não foi possível confirmar uma resposta real da IA.";
  }
}

/**
 * Stops at the first genuine model response; skips further Gateway probes when
 * the account itself is blocked. Independent providers are still eligible.
 * Limit to 5 attempts to bound cost and latency on user-initiated DIAG.
 */
export async function runInferenceProbes(probes: ProbeCandidate[]): Promise<DiagnosticResult> {
  const attempts: ProbeAttempt[] = [];
  let gatewayBlocked = false;

  for (const candidate of probes.slice(0, 5)) {
    if (gatewayBlocked && candidate.provider.startsWith("ai-gateway:")) continue;
    try {
      const answer = await candidate.run();
      if (matchesProbeAnswer(answer)) {
        attempts.push({ provider: candidate.provider, status: "success" });
        return {
          inferenceVerified: true,
          testStatus: "success",
          provider: candidate.provider,
          message: "O provedor indicado gerou o marcador de teste esperado.",
          attempts,
        };
      }
      attempts.push({ provider: candidate.provider, status: "UNEXPECTED_ANSWER" });
    } catch (error) {
      const status = classifyProbeFailure(error);
      attempts.push({ provider: candidate.provider, status });
      if (candidate.provider.startsWith("ai-gateway:") && PERMANENT_GATEWAY_FAILURES.has(status)) {
        gatewayBlocked = true;
      }
    }
  }

  const primaryFailure = attempts.find((attempt) => attempt.status !== "UNEXPECTED_ANSWER")?.status
    ?? attempts[0]?.status ?? "PROVIDER_ERROR";
  return {
    inferenceVerified: false,
    testStatus: primaryFailure,
    provider: attempts.at(-1)?.provider ?? "none",
    message: statusMessage(primaryFailure),
    attempts,
  };
}
