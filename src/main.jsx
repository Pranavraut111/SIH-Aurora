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
