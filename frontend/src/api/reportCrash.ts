import api from './client';

// Tells the server a page crashed (the "This page couldn't be displayed"
// screen), so the team gets an email instead of waiting for a complaint.
// Plain fetch (not the api client) so a failure here can never trigger a
// logout/redirect; only sent when signed in; never throws.
export function reportCrash(error: Error, componentStack?: string | null) {
  try {
    const token = localStorage.getItem('erp_token');
    if (!token) return;
    const stack = [error.stack, componentStack].filter(Boolean).join('\n--- component stack ---\n');
    void fetch(`${api.defaults.baseURL}/monitoring/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: String(error.message || error.name || 'Unknown error').slice(0, 500),
        stack: stack.slice(0, 4000),
        path: window.location.pathname.slice(0, 300),
        userAgent: navigator.userAgent.slice(0, 300),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // reporting must never make things worse
  }
}
