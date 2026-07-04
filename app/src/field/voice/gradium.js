// Gradium STT adapter — OPTIONAL upgrade path (agent VOICE).
//
// PRD §4.3: Gradium STT for Spanish field reports (45k free credits, coupon
// RAISE-2026). This sits behind the SAME interface the Web Speech hook exposes so
// VoiceInput can swap engines with no UI change. It is NOT wired on by default and
// is non-blocking: until a key lands in context/inbox/ (see context/inbox/voice-to-nick.md)
// or VITE_GRADIUM_API_KEY is set, `isGradiumEnabled()` returns false and VoiceInput
// stays on Web Speech.
//
// When enabled, the intended flow (fill in once the endpoint contract is confirmed):
//   1. Capture mic audio via MediaRecorder (webm/opus).
//   2. POST/stream chunks to the Gradium STT endpoint with the API key + lang=es.
//   3. Emit finalized transcript segments through onFinal(text), matching the hook.
//
// Advantage over Web Speech: higher-quality Spanish + potential on-prem/offline
// deployment (removes the internet dependency Web Speech has on mobile).

const API_KEY =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_GRADIUM_API_KEY) ||
  null

export function isGradiumEnabled() {
  return !!API_KEY
}

// Placeholder engine with the same shape start/stop/onFinal so VoiceInput can adopt
// it later without structural changes. Intentionally inert until the endpoint is
// confirmed — throws only if someone flips it on prematurely.
export function createGradiumEngine() {
  if (!API_KEY) {
    throw new Error(
      'Gradium STT not configured — set VITE_GRADIUM_API_KEY (see context/inbox/voice-to-nick.md).',
    )
  }
  throw new Error(
    'Gradium STT endpoint not wired yet — confirm URL + request/response shape first.',
  )
}
