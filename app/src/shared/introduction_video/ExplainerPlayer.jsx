import { useCallback, useEffect, useRef, useState } from 'react'
import { Player } from '@remotion/player'
import ExplainerComposition from './ExplainerComposition.jsx'
import { FPS, WIDTH, HEIGHT, TOTAL_FRAMES, sceneStarts, BG_0 } from './constants.js'
import './ExplainerPlayer.css'

const CHAPTERS = sceneStarts()

// Interactive shell around the Remotion <Player>: click/tap the stage to
// toggle play, or jump straight to a chapter. Same component will get
// dropped onto the marketing site later — this file is the only thing that
// changes when it's nested.
export default function ExplainerPlayer() {
  const playerRef = useRef(null)
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const player = playerRef.current
    if (!player) return undefined
    const onFrame = (e) => setFrame(e.detail.frame)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    return () => {
      player.removeEventListener('frameupdate', onFrame)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (player.isPlaying()) player.pause()
    else player.play()
  }, [])

  const jumpTo = useCallback((f) => {
    const player = playerRef.current
    if (!player) return
    player.seekTo(f)
    player.play()
  }, [])

  const activeIndex = CHAPTERS.findIndex((s, i) => {
    const next = CHAPTERS[i + 1]
    return frame >= s.start && (!next || frame < next.start)
  })

  return (
    <div className="bru-explainer">
      <div
        className="bru-explainer__stage"
        onClick={togglePlay}
        role="button"
        tabIndex={0}
        aria-label={playing ? 'Pause video' : 'Play video'}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            togglePlay()
          }
        }}
      >
        <Player
          ref={playerRef}
          component={ExplainerComposition}
          durationInFrames={TOTAL_FRAMES}
          fps={FPS}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          loop
          autoPlay
          initiallyMuted
          controls={false}
          clickToPlay={false}
          spaceKeyToPlayOrPause={false}
          doubleClickToFullscreen={false}
          style={{ width: '100%', display: 'block', aspectRatio: `${WIDTH} / ${HEIGHT}`, background: BG_0 }}
        />
        <div className="bru-explainer__playhint" data-visible={!playing || undefined} aria-hidden="true">
          {playing ? '❚❚' : '▸'}
        </div>
      </div>

      <div className="bru-explainer__chapters">
        {CHAPTERS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="bru-explainer__chip"
            data-active={i === activeIndex || undefined}
            onClick={(e) => {
              e.stopPropagation()
              jumpTo(s.start)
            }}
          >
            <span className="bru-explainer__chip-index">{String(i + 1).padStart(2, '0')}</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
