import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { fadeInOut, clamp01 } from '../utils.js'
import { BG_0, BG_2, BORDER_STRONG, TEXT, TEXT_DIM, TEXT_MUTE, BRAND_RED, OK, FONT_DISPLAY, FONT_SANS, FONT_MONO } from '../constants.js'

const PRESS_AT = 70

export default function SceneHuman({ durationInFrames }) {
  const frame = useCurrentFrame()
  const opacity = fadeInOut(frame, durationInFrames)

  const cardIn = clamp01(frame, 0, 16)
  const pressed = frame >= PRESS_AT
  const pressScale = interpolate(frame, [PRESS_AT, PRESS_AT + 6, PRESS_AT + 14], [1, 0.94, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const checkIn = clamp01(frame, PRESS_AT + 10, PRESS_AT + 24)
  const captionIn = clamp01(frame, PRESS_AT + 30, PRESS_AT + 48)

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG_0,
        opacity,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        padding: 40,
        lineHeight: 'normal',
      }}
    >
      <div
        style={{
          width: 400,
          background: BG_2,
          border: `1px solid ${BORDER_STRONG}`,
          borderRadius: 14,
          padding: 22,
          opacity: cardIn,
          transform: `translateY(${(1 - cardIn) * 14}px) scale(${pressScale})`,
        }}
      >
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_MUTE, letterSpacing: '0.1em', marginBottom: 10 }}>
          DISPATCH PROPOSAL
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: TEXT, fontWeight: 700, marginBottom: 8 }}>
          Heavy machinery team → Playa Grande
        </div>
        <div style={{ fontFamily: FONT_SANS, fontSize: 13, color: TEXT_DIM, marginBottom: 18 }}>
          Nearest available resource · ETA 12 min
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: pressed ? 'rgba(42,125,86,0.16)' : 'rgba(176,58,70,0.14)',
            border: `1px solid ${pressed ? OK : BRAND_RED}`,
            color: pressed ? OK : BRAND_RED,
            borderRadius: 8,
            padding: '8px 18px',
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}
        >
          <span style={{ opacity: checkIn }}>✓</span> {pressed ? 'CONFIRMED' : 'CONFIRM'}
        </div>
      </div>

      <p
        style={{
          fontFamily: FONT_SANS,
          color: TEXT_DIM,
          fontSize: 19,
          marginTop: 30,
          textAlign: 'center',
          maxWidth: 600,
          opacity: captionIn,
        }}
      >
        The AI <em style={{ color: TEXT, fontStyle: 'normal' }}>proposes</em>. The human{' '}
        <em style={{ color: TEXT, fontStyle: 'normal', borderBottom: `2px solid ${BRAND_RED}` }}>decides</em>.
      </p>
    </AbsoluteFill>
  )
}
