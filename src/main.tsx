import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import App from './App';
import './styles.css';
import './join.css';
import { getPagesRedirect } from './lib/pagesRedirect';

const storedRedirect = sessionStorage.getItem('redirect');
sessionStorage.removeItem('redirect');
const restoredPath = getPagesRedirect(storedRedirect, window.location.origin, import.meta.env.BASE_URL);
if (restoredPath) window.history.replaceState(null, '', restoredPath);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
