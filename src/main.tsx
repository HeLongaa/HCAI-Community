import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './home-workbench.css'
import './tasks-workbench.css'
import './community-workbench.css'
import './inspiration-workbench.css'
import './workspace-workbench.css'
import './asset-library.css'
import './primary-page-motion.css'
import './generation-center.css'
import './product-system.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/errors/AppErrorBoundary.tsx'
import { installGlobalClientErrorReporting } from './services/clientTelemetry.ts'

installGlobalClientErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
