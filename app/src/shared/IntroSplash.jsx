import { useEffect, useRef, useState } from 'react'
import './IntroSplash.css'

const LETTERS = ['B', 'R', 'Ú', 'J', 'U', 'L', 'A']
const HOLD_MS = 2900
const EXIT_MS = 650

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function IntroSplash() {
  const [phase, setPhase] = useState('spin') // spin -> exiting -> done
  const [settled, setSettled] = useState(false)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [ripple, setRipple] = useState(null)
  const skippedRef = useRef(false)
  const reduceMotionRef = useRef(prefersReducedMotion())
  const reduceMotion = reduceMotionRef.current
  const holdMs = reduceMotion ? 200 : HOLD_MS
  const exitMs = reduceMotion ? 120 : EXIT_MS

  useEffect(() => {
    const toExit = setTimeout(() => setPhase('exiting'), holdMs)
    const toDone = setTimeout(() => setPhase('done'), holdMs + exitMs)
    return () => {
      clearTimeout(toExit)
      clearTimeout(toDone)
    }
  }, [holdMs, exitMs])

  function skip(e) {
    if (skippedRef.current) return
    skippedRef.current = true
    if (e) setRipple({ x: e.clientX, y: e.clientY, id: Date.now() })
    setPhase('exiting')
    setTimeout(() => setPhase('done'), exitMs)
  }

  function handlePointerMove(e) {
    if (!settled || reduceMotion) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: py * -22, y: px * 26 })
  }

  function handlePointerLeave() {
    setTilt({ x: 0, y: 0 })
  }

  if (phase === 'done') return null

  return (
    <div
      className={`bru-intro${phase === 'exiting' ? ' bru-intro--exit' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Saltar animación de bienvenida"
      onClick={skip}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') skip()
      }}
    >
      <div className="bru-intro__scan" aria-hidden="true" />

      <div
        className="bru-intro__stage"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <div
          className="bru-intro__compass-spin"
          onAnimationEnd={() => setSettled(true)}
        >
          <div
            className="bru-intro__tilt"
            style={{
              transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            }}
          >
            <div className="bru-intro__radar" aria-hidden="true" />
            <div className="bru-intro__glow" aria-hidden="true" />
            <img
              className="bru-intro__compass"
              src="/logo-animated.svg"
              alt="Brújula"
              width="168"
              height="168"
            />
          </div>
        </div>

        <h1 className="bru-intro__wordmark" aria-label="BRÚJULA">
          {LETTERS.map((ch, i) => (
            <span
              key={i}
              className="bru-intro__letter"
              style={{ '--i': i }}
              aria-hidden="true"
            >
              {ch}
            </span>
          ))}
        </h1>
      </div>

      <div className="bru-intro__progress" aria-hidden="true">
        <span style={{ animationDuration: `${holdMs}ms` }} />
      </div>

      <p className="bru-intro__hint">Toque para omitir</p>

      {ripple && (
        <span
          key={ripple.id}
          className="bru-intro__ripple"
          style={{ left: ripple.x, top: ripple.y }}
        />
      )}
    </div>
  )
}
