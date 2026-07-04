export const FPS = 30
export const WIDTH = 1280
export const HEIGHT = 720

// Chapter timeline — each scene owns a slice of the timeline; chapter chips
// in ExplainerPlayer jump straight to a slice's start frame.
export const SCENES = [
  { id: 'problem', label: 'THE PROBLEM', frames: 150 },
  { id: 'intro', label: 'BRÚJULA', frames: 90 },
  { id: 'flow', label: 'HOW IT WORKS', frames: 240 },
  { id: 'human', label: 'HUMAN IN COMMAND', frames: 180 },
  { id: 'close', label: 'NO NETWORK. NO CLOUD.', frames: 120 },
]

export function sceneStarts() {
  let acc = 0
  return SCENES.map((s) => {
    const start = acc
    acc += s.frames
    return { ...s, start }
  })
}

export const TOTAL_FRAMES = SCENES.reduce((sum, s) => sum + s.frames, 0)

// Brújula design tokens (app/src/shared/tokens.css), inlined here so the
// composition has no CSS-cascade dependency on where the Player is mounted.
export const BG_0 = '#0e1411'
export const BG_1 = '#17211b'
export const BG_2 = '#1f2d25'
export const BORDER = '#2e4436'
export const BORDER_STRONG = '#3c5445'
export const TEXT = '#eff4f1'
export const TEXT_DIM = '#9cb3a5'
export const TEXT_MUTE = '#62766a'

export const BRAND_RED = '#b03a46'
export const BRAND_RED_DIM = '#7d2530'
export const CRITICAL = '#ff453a'
export const OK = '#2a7d56'

export const FONT_DISPLAY = '"Chakra Petch", "Barlow", system-ui, sans-serif'
export const FONT_SANS = '"Barlow", system-ui, "Segoe UI", sans-serif'
export const FONT_MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace'
