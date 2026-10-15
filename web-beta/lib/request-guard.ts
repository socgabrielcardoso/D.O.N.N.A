/**
 * Bounded request ingestion for costly cloud endpoints.
 *
 * Origin is a CSRF friction control, NOT owner authentication: non-browser
 * callers can forge it. Paid routes still need an authenticated owner and
 * durable quotas before being considered safe on the public internet.
 */
export type BoundedBody =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; response: Response };

function reject(status: number, code: string): BoundedBody {
  return {
    ok: false,
    response: Response.json(
      { error: "Requisição inválida ou não autorizada.", code },
      { status, headers: { "Cache-Control": "no-store" } },
    ),
  };
}

/** Do not trust Host or Origin as an identity signal. */
export function isSameOrigin(request: Request): boolean {
  const provided = request.headers.get("origin");
  if (!provided || provided === "null") return false;
  try {
    const origin = new URL(provided);
    const target = new URL(request.url);
    return (
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash &&
      origin.origin === target.origin
    );
  } catch {
    return false;
  }
}

/**
 * Consume a request stream with a strict upper bound, even when Content-Length
 * is omitted, forged, or incorrectly smaller than the payload.
 */
export async function readBoundedBody(
  request: Request,
  mediaType: "application/json" | "multipart/form-data",
  maxBytes: number,
): Promise<BoundedBody> {
  if (!isSameOrigin(request)) return reject(403, "ORIGIN_REQUIRED");

  const declaredType = request.headers.get("content-type") ?? "";
  const actualType = declaredType.split(";")[0]?.trim().toLowerCase();
  if (actualType !== mediaType ||
      (mediaType === "multipart/form-data" && !/;\s*boundary=[^;]+/i.test(declaredType))) {
    return reject(415, "MEDIA_TYPE_UNSUPPORTED");
  }

  const declaredSize = request.headers.get("content-length");
  if (declaredSize !== null) {
    if (!/^\d+$/.test(declaredSize)) return reject(400, "BAD_CONTENT_LENGTH");
    if (Number(declaredSize) > maxBytes) return reject(413, "BODY_TOO_LARGE");
  }

  if (!request.body) return reject(400, "EMPTY_BODY");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return reject(413, "BODY_TOO_LARGE");
      }
      parts.push(value);
    }
  } catch {
    return reject(400, "UNREADABLE_BODY");
  } finally {
    reader.releaseLock();
  }

  if (received === 0) return reject(400, "EMPTY_BODY");
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, bytes };
}

export function parseJsonBody<T>(bytes: Uint8Array): T | null {
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return body && typeof body === "object" && !Array.isArray(body) ? body as T : null;
  } catch {
    return null;
  }
}
