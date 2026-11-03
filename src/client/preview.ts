/** Restore the reading position when an editor save refreshes the route. */
const KEY = 'astroDevEditPreview';
export function initPreview() {
  try {
    if (sessionStorage.getItem('astroDevEditMode') !== '1') return;
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { route: string; x: number; y: number } | null;
    if (saved?.route === location.pathname + location.search && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const restore = () => window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
      restore(); requestAnimationFrame(restore);
      document.fonts?.ready.then(restore);
      if (document.readyState !== 'complete') window.addEventListener('load', restore, { once: true });
    }
  } catch { /* Storage is optional. */ }
}
window.addEventListener('beforeunload', () => {
  try {
    if (sessionStorage.getItem('astroDevEditMode') === '1') sessionStorage.setItem(KEY, JSON.stringify({ route: location.pathname + location.search, x: scrollX, y: scrollY }));
  } catch { /* Browsing remains available when storage is disabled. */ }
});
