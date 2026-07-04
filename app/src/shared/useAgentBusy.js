// React hook over api.js's agent-activity signal: true while a request that
// makes the hub think (Gemma work) is in flight. Drives the compass needle.

import { useEffect, useState } from 'react'
import { subscribeAgentBusy } from './api.js'

export function useAgentBusy() {
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribeAgentBusy(setBusy), [])
  return busy
}
