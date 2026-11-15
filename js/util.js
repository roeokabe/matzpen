export const $ = (id) => document.getElementById(id);

export function dateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function showResult(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

export function showError(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

export async function withBusy(btn, busyLabel, errorId, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyLabel;
  showError(errorId, '');
  try {
    await fn();
  } catch (err) {
    showError(errorId, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
