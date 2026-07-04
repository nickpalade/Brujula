import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { fadeInOut, clamp01 } from '../utils.js'
import { BG_0, BRAND_RED, BORDER_STRONG, TEXT, TEXT_DIM, FONT_SANS, FONT_MONO } from '../constants.js'

const WORD = 'BRÚJULA'

export default function SceneIntro({ durationInFrames }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = fadeInOut(frame, durationInFrames)

  const markScale = spring({ frame, fps, config: { damping: 12, mass: 0.6 } })
  const needleRot = interpolate(frame, [0, durationInFrames], [-20, 380])

  return (
    <AbsoluteFill
      style={{ backgroundColor: BG_0, opacity, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', lineHeight: 'normal' }}
    >
      <div style={{ transform: `scale(${markScale})`, marginBottom: 22 }}>
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r="40" fill="none" stroke={BRAND_RED} strokeWidth="2.5" opacity="0.55" />
          <circle cx="44" cy="44" r="3" fill={BRAND_RED} />
          <g transform={`rotate(${needleRot} 44 44)`}>
            <polygon points="44,10 49,44 44,50 39,44" fill={BRAND_RED} />
            <polygon points="44,78 49,44 44,38 39,44" fill={BORDER_STRONG} />
          </g>
        </svg>
      </div>

      <div style={{ display: 'flex', fontFamily: FONT_MONO, fontWeight: 700, fontSize: 54, letterSpacing: '0.06em', color: BRAND_RED }}>
        {WORD.split('').map((ch, i) => {
          const local = frame - 8 - i * 2
          const y = interpolate(local, [0, 10], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const o = interpolate(local, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          return (
            <span key={i} style={{ display: 'inline-block', transform: `translateY(${y}px)`, opacity: o }}>
              {ch}
            </span>
          )
        })}
      </div>

      <p
        style={{
          fontFamily: FONT_SANS,
          color: TEXT_DIM,
          fontSize: 19,
          marginTop: 16,
          textAlign: 'center',
          maxWidth: 640,
          opacity: clamp01(frame, 42, 60),
        }}
      >
        Emergency coordination that works{' '}
        <em style={{ color: TEXT, fontStyle: 'normal', borderBottom: `2px solid ${BRAND_RED}` }}>when the network doesn't</em>.
      </p>
    </AbsoluteFill>
  )
}
