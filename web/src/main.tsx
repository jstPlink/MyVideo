import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { isNative } from './api';
import App from './App';
import './styles.css';

// Nell'APK le pagine sono file locali: serve il router ad hash.
const Router = isNative ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </StrictMode>,
);
