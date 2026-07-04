import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ExplainerPlayer from './shared/introduction_video/ExplainerPlayer.jsx'
import './shared/tokens.css'

// Standalone preview harness — NOT wired into App.jsx/routes. Lets us look
// at the explainer video in isolation before it's nested into the real site.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: '#0e1411',
        padding: '5vh 5vw',
      }}
    >
      <div style={{ width: 'min(92vw, 960px)' }}>
        <ExplainerPlayer />
      </div>
      <p
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 12,
          letterSpacing: '0.08em',
          color: '#62766a',
        }}
      >
        PREVIEW HARNESS — /introduction_video.html · not linked from the real app yet
      </p>
    </div>
  </StrictMode>,
)
