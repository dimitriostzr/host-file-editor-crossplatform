// SPDX-License-Identifier: MIT

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './index.css'

// Lets the stylesheet keep each platform's native look where it differs (scrollbars).
document.documentElement.dataset['platform'] = window.hostserrer.platform

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
