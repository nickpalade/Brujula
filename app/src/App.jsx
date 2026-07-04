import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'

import CommandPost from './command/CommandPost.jsx'
import FieldClient from './field/FieldClient.jsx'

function Home() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Brújula</h1>
      <p>Offline disaster-response coordinator — pick a station:</p>
      <ul>
        <li>
          <Link to="/command">/command — Command Post (laptop)</Link>
        </li>
        <li>
          <Link to="/field">/field — Field client (mobile)</Link>
        </li>
      </ul>
    </main>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/command" element={<CommandPost />} />
        <Route path="/field" element={<FieldClient />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
