// The Brújula mark as a live component: rings static, needle spins while the
// agent is working (pass `spinning`). Inlined from design/logo-rings.svg +
// design/logo-compass.svg (same 256 viewBox) so the loading indicator IS the
// logo — no external asset, works offline like everything else.

import './brujula-mark.css'

function BrujulaMark({ size = 28, spinning = false, title = 'Brújula' }) {
  return (
    <svg
      className={`bru-mark${spinning ? ' bru-mark--spin' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label={spinning ? `${title} — procesando` : title}
    >
      <g>
        <path
          d="M 182.2 58.7 A 88 88 0 1 0 182.2 197.3"
          fill="none" stroke="#eff4f1" strokeWidth="14" strokeLinecap="round"
        />
        <path
          d="M 186 101 A 64 64 0 0 1 186 155"
          fill="none" stroke="#eff4f1" strokeWidth="14" strokeLinecap="round"
        />
        <path
          d="M 200.1 79.3 A 87 87 0 0 1 200.1 176.7"
          fill="none" stroke="#eff4f1" strokeWidth="14" strokeLinecap="round"
        />
      </g>
      <g className="bru-mark__needle">
        <polygon points="128,42 150,128 106,128" fill="#b03a46" />
        <polygon points="106,128 150,128 128,214" fill="#eff4f1" />
      </g>
      <circle cx="128" cy="128" r="13" fill="#b03a46" stroke="#8e2e39" strokeWidth="3" />
    </svg>
  )
}

export default BrujulaMark
