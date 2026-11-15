// Screens register what to refresh when they are shown, so nav.js depends on none of them.
const showHandlers = new Map();

export function onShow(name, fn) {
  showHandlers.set(name, fn);
}

export function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.tabs button').forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  showHandlers.get(name)?.();
}
