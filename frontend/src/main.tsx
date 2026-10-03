import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import PageErrorBoundary from './components/PageErrorBoundary';
import './index.css';
// SVG-sprite country flags (used for the HR "Nationality" flag badges) —
// bundled locally so flags render as real flag icons on every OS/browser,
// instead of relying on the OS's emoji font (Windows shows plain "BD"-style
// letters for flag emoji instead of a picture).
import 'flag-icons/css/flag-icons.min.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Last line of defence: if anything outside a page crashes (sidebar,
          top bar, auth), show the error instead of a blank white screen. */}
      <PageErrorBoundary resetKey="app">
        <AuthProvider>
          <App />
        </AuthProvider>
      </PageErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
