/**
 * Realtime voice sessions are deliberately disabled in the public cloud beta.
 *
 * Previously this endpoint issued temporary provider credentials to any HTTP
 * caller, without identity verification or a durable per-user quota. A
 * same-origin check alone would NOT be authentication (clients can forge Origin).
 *
 * Keep token issuance unavailable until a separate reviewed change implements
 * authenticated, authorized sessions and server-side rate/cost controls.
 * The ordinary speech/transcription endpoints are independent of this route.
 */
export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error: "Sessões de voz em tempo real estão temporariamente indisponíveis por segurança.",
      code: "REALTIME_VOICE_DISABLED",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
