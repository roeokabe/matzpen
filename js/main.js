// Entry point: starts each screen, wires the tab bar, and registers the service worker.
import { $, dateKey } from './util.js';
import { showView } from './nav.js';
import { initCheckin, flushSave, openDay, isShowingToday } from './checkin.js';
import { initTasks } from './tasks.js';
import { initSettings } from './settings.js';

function initTabs() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', async () => {
      await flushSave();
      if (b.dataset.view === 'today' && !isShowingToday()) await openDay(dateKey());
      else showView(b.dataset.view);
    });
  });
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) $('update-banner').hidden = false;
  });
  $('update-reload').addEventListener('click', () => location.reload());
  navigator.serviceWorker.register('sw.js');
}

initTabs();
await initCheckin();
await initTasks();
await initSettings();
navigator.storage?.persist?.();
initServiceWorker();
