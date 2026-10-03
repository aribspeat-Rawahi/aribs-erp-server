// Small self-contained notice bar (bottom of the screen) for messages that
// don't belong to any one page, e.g. "You don't have permission to view
// Payments." The same message isn't repeated while it's still showing.
let current: HTMLDivElement | null = null;
let hideTimer: number | undefined;

export function showNotice(message: string) {
  if (typeof document === 'undefined') return;
  if (current && current.textContent === message) return;
  current?.remove();
  window.clearTimeout(hideTimer);

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = message; // textContent, never innerHTML - message comes from the server
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:20px',
    'transform:translateX(-50%)',
    'z-index:1000',
    'max-width:calc(100vw - 32px)',
    'background:#1f2937',
    'color:#fff',
    'padding:10px 16px',
    'border-radius:8px',
    'font-size:14px',
    'box-shadow:0 4px 12px rgba(0,0,0,.2)',
  ].join(';');
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  current = el;
  hideTimer = window.setTimeout(() => {
    el.remove();
    if (current === el) current = null;
  }, 5000);
}
