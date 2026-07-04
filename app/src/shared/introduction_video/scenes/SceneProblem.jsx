import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { fadeInOut, clamp01 } from '../utils.js'
import { BG_0, TEXT, TEXT_DIM, CRITICAL, FONT_DISPLAY, FONT_SANS, FONT_MONO } from '../constants.js'

const BUBBLES = [
  { text: '"...urgent, building colla—"', x: '6%', y: '16%', delay: 4, rot: -4 },
  { text: '"is anyone there? no sig—"', x: '66%', y: '10%', delay: 14, rot: 3 },
  { text: '"we need help in Catia—"', x: '10%', y: '64%', delay: 24, rot: 2 },
  { text: '"duplicate? same report x3"', x: '60%', y: '70%', delay: 34, rot: -3 },
  { text: '"no coverage... retrying"', x: '36%', y: '42%', delay: 44, rot: 5 },
]

export default function SceneProblem({ durationInFrames }) {
  const frame = useCurrentFrame()
  const opacity = fadeInOut(frame, durationInFrames)

  return (
    <AbsoluteFill style={{ backgroundColor: BG_0, opacity, overflow: 'hidden', lineHeight: 'normal' }}>
      <AbsoluteFill
        style={{
          opacity: interpolate(Math.sin(frame * 1.4), [-1, 1], [0.02, 0.07]),
          background: 'repeating-linear-gradient(0deg, rgba(255,69,58,0.5) 0px, transparent 2px, transparent 4px)',
          mixBlendMode: 'overlay',
        }}
      />

      {BUBBLES.map((b, i) => {
        const local = frame - b.delay
        const rise = interpolate(local, [0, 18], [16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const fade = interpolate(local, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: b.x,
              top: b.y,
              transform: `translateY(${rise}px) rotate(${b.rot}deg)`,
              opacity: fade * 0.85,
              background: 'rgba(31,45,37,0.9)',
              border: '1px solid rgba(255,69,58,0.35)',
              borderRadius: 10,
              padding: '10px 14px',
              color: TEXT_DIM,
              fontFamily: FONT_MONO,
              fontSize: 15,
              maxWidth: 260,
            }}
          >
            {b.text}
          </div>
        )
      })}

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', textAlign: 'center', padding: 40 }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            color: CRITICAL,
            fontSize: 15,
            letterSpacing: '0.25em',
            opacity: clamp01(frame, 50, 66),
            marginBottom: 14,
          }}
        >
          SIGNAL LOST
        </div>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            color: TEXT,
            fontSize: 44,
            fontWeight: 700,
            maxWidth: 780,
            margin: 0,
            opacity: clamp01(frame, 58, 76),
          }}
        >
          When disaster strikes, the network goes down.
        </h1>
        <p
          style={{
            fontFamily: FONT_SANS,
            color: TEXT_DIM,
            fontSize: 19,
            maxWidth: 620,
            marginTop: 18,
            opacity: clamp01(frame, 78, 96),
          }}
        >
          Scattered, duplicate reports with no coordination — while the clock runs.
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
