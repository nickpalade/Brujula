import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { fadeInOut, clamp01 } from '../utils.js'
import { BG_0, BRAND_RED, TEXT, TEXT_DIM, FONT_DISPLAY, FONT_SANS, FONT_MONO } from '../constants.js'

export default function SceneClose({ durationInFrames }) {
  const frame = useCurrentFrame()
  const opacity = fadeInOut(frame, durationInFrames)

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG_0,
        opacity,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        textAlign: 'center',
        padding: 40,
        lineHeight: 'normal',
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: '0.08em',
          color: BRAND_RED,
          opacity: clamp01(frame, 0, 16),
        }}
      >
        BRÚJULA
      </div>
      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          color: TEXT,
          fontSize: 30,
          fontWeight: 700,
          margin: '16px 0 0',
          opacity: clamp01(frame, 12, 30),
        }}
      >
        No cloud. No internet.
      </h2>
      <p
        style={{
          fontFamily: FONT_SANS,
          color: TEXT_DIM,
          fontSize: 18,
          maxWidth: 560,
          marginTop: 12,
          opacity: clamp01(frame, 26, 46),
        }}
      >
        Emergency coordination for the first hours — when everything else fails.
      </p>
    </AbsoluteFill>
  )
}
