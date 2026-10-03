import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts: IBM Plex Sans (variable, UI and figures) + IBM Plex Mono (times, ids, code). Self-hosted.
import '@fontsource-variable/ibm-plex-sans/wght.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import AppThemeProvider from './theme/AppThemeProvider.jsx'
import App from './App.jsx'
import FeedbackProvider from './ui/FeedbackProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppThemeProvider>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </AppThemeProvider>
  </StrictMode>,
)

// Visit counter (Administration → Visits): loaded once the page has loaded, so it adds
// nothing to startup. The query is read now, before a ?story= link is consumed.
const entrySearch = window.location.search
window.addEventListener('load', () => {
  import('./lib/visit.js')
    .then((m) => m.recordVisit(entrySearch))
    .catch((err) => console.warn('[visit] beacon not loaded', err))
}, { once: true })
