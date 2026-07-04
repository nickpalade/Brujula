import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { fadeInOut, clamp01 } from '../utils.js'
import {
  BG_0,
  BG_2,
  BORDER,
  BORDER_STRONG,
  TEXT,
  TEXT_DIM,
  TEXT_MUTE,
  CRITICAL,
  BRAND_RED,
  FONT_DISPLAY,
  FONT_SANS,
  FONT_MONO,
} from '../constants.js'

const RAW_TEXT = 'Urgent, building collapsed in Playa Grande. We hear voices, ~20 trapped.'

function Arrow({ progress }) {
  return (
    <svg width="60" height="24" viewBox="0 0 60 24" style={{ opacity: progress, flexShrink: 0 }}>
      <line x1="2" y1="12" x2={2 + 46 * progress} y2="12" stroke={TEXT_MUTE} strokeWidth="2" strokeDasharray="4 4" />
      <polygon points="48,6 58,12 48,18" fill={TEXT_MUTE} opacity={progress > 0.85 ? 1 : 0} />
    </svg>
  )
}

export default function SceneFlow({ durationInFrames }) {
  const frame = useCurrentFrame()
  const opacity = fadeInOut(frame, durationInFrames)

  const card1In = clamp01(frame, 0, 16)
  const typeLen = Math.floor(
    interpolate(frame, [18, 70], [0, RAW_TEXT.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  const arrow1 = clamp01(frame, 74, 96)

  const card2In = clamp01(frame, 92, 108)
  const dotsPhase = Math.floor(frame / 8) % 4
  const arrow2 = clamp01(frame, 150, 172)

  const card3In = clamp01(frame, 168, 188)
  const badgeIn = clamp01(frame, 188, 200)

  const captionIn = clamp01(frame, 205, 222)

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
          fontFamily: FONT_MONO,
          color: TEXT_MUTE,
          fontSize: 14,
          letterSpacing: '0.22em',
          marginBottom: 28,
          opacity: clamp01(frame, 0, 12),
        }}
      >
        HOW IT WORKS
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 250,
            minHeight: 150,
            background: BG_2,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 16,
            opacity: card1In,
            transform: `translateY(${(1 - card1In) * 12}px)`,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_MUTE, letterSpacing: '0.1em', marginBottom: 10 }}>
            📱 FIELD REPORT
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 14, color: TEXT_DIM, lineHeight: 1.5 }}>
            {RAW_TEXT.slice(0, typeLen)}
            <span style={{ opacity: typeLen < RAW_TEXT.length ? 1 : 0 }}>▍</span>
          </div>
        </div>

        <Arrow progress={arrow1} />

        <div
          style={{
            width: 190,
            minHeight: 150,
            background: BG_2,
            border: `1px solid ${BORDER_STRONG}`,
            borderRadius: 12,
            padding: 16,
            opacity: card2In,
            transform: `translateY(${(1 - card2In) * 12}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: 10,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_MUTE, letterSpacing: '0.1em' }}>OFFLINE · GEMMA</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: TEXT, fontWeight: 700 }}>Analyzing{'.'.repeat(dotsPhase)}</div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: `3px solid ${BORDER_STRONG}`,
              borderTopColor: BRAND_RED,
              transform: `rotate(${frame * 12}deg)`,
            }}
          />
        </div>

        <Arrow progress={arrow2} />

        <div
          style={{
            width: 260,
            minHeight: 150,
            background: BG_2,
            border: `1px solid ${CRITICAL}66`,
            borderRadius: 12,
            padding: 16,
            opacity: card3In,
            transform: `translateY(${(1 - card3In) * 12}px)`,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                fontWeight: 700,
                color: CRITICAL,
                background: 'rgba(255,69,58,0.14)',
                border: `1px solid ${CRITICAL}88`,
                borderRadius: 6,
                padding: '2px 8px',
                opacity: badgeIn,
              }}
            >
              CRITICAL
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_MUTE }}>RESCUE</span>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, color: TEXT, fontWeight: 700, marginBottom: 6 }}>
            Playa Grande, Catia La Mar
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 13, color: TEXT_DIM }}>~20 people trapped · voices under the rubble</div>
        </div>
      </div>

      <p
        style={{
          fontFamily: FONT_SANS,
          color: TEXT_DIM,
          fontSize: 17,
          marginTop: 34,
          textAlign: 'center',
          maxWidth: 640,
          opacity: captionIn,
        }}
      >
        From a messy report to an actionable incident — in seconds, offline.
      </p>
    </AbsoluteFill>
  )
}
