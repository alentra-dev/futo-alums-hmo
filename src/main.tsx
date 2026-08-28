import { getPagesRedirect } from './lib/pagesRedirect';

const storedRedirect = sessionStorage.getItem('redirect');
sessionStorage.removeItem('redirect');
const restoredPath = getPagesRedirect(storedRedirect, window.location.origin, import.meta.env.BASE_URL);
if (restoredPath) window.history.replaceState(null, '', restoredPath);

// Load the application only after a GitHub Pages deep link has been restored.
// Supabase reads one-time auth credentials from the URL when its client is created.
void import('./bootstrap');
