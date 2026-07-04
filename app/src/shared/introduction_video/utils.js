import { interpolate } from 'remotion'

// Every scene fades in/out at its own edges so hard Sequence cuts read as
// crossfades instead of jumps, without needing a transitions dependency.
export function fadeInOut(frame, durationInFrames, fadeFrames = 15) {
  const fadeIn = interpolate(frame, [0, fadeFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const fadeOut = interpolate(frame, [durationInFrames - fadeFrames, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return Math.min(fadeIn, fadeOut)
}

export function clamp01(frame, from, to) {
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}
