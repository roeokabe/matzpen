// Settings: the API key, backup and restore, and wiping all data.
import { $, dateKey } from './util.js';
import { putEntry, allEntries, getKv, setKv, putTask, allTasks, clearStore } from './db.js';
import { blankEntry, isValidEntry, flushSave, discardPendingSave, reloadCheckin } from './checkin.js';
import { isValidTask, normalizeTask, reloadTasks } from './tasks.js';
import { showView } from './nav.js';

async function exportBackup() {
  await flushSave();
  const data = {
    app: 'matzpen',
    version: 2,
    exportedAt: new Date().toISOString(),
    entries: await allEntries(),
    tasks: await allTasks(),
    pattern: await getKv('pattern'),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `matzpen-backup-${dateKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  $('backup-status').textContent = 'הגיבוי ירד. המפתח לא נכלל בו.';
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const tasks = data.tasks ?? [];
    if (data.app !== 'matzpen' || !Array.isArray(data.entries) || !data.entries.every(isValidEntry)
      || !Array.isArray(tasks) || !tasks.every(isValidTask)) throw new Error('bad backup');
    if (!confirm(`לשחזר ${data.entries.length} ימים ו-${tasks.length} משימות? פריטים זהים יוחלפו.`)) return;
    await flushSave();
    for (const entry of data.entries) await putEntry({ ...blankEntry(entry.date), ...entry });
    for (const task of tasks) await putTask(normalizeTask(task));
    if (data.pattern) await setKv('pattern', data.pattern);
    await reloadCheckin();
    await reloadTasks();
    $('backup-status').textContent = 'השחזור הושלם.';
  } catch {
    $('backup-status').textContent = 'הקובץ הזה לא נראה כמו גיבוי של מצפן.';
  }
}

async function wipeAll() {
  if (!confirm('למחוק את כל הימים, המשימות, התובנות והמפתח מהמכשיר? אי אפשר לבטל את זה.')) return;
  discardPendingSave();
  await clearStore('entries');
  await clearStore('tasks');
  await clearStore('kv');
  $('api-key').value = '';
  await reloadCheckin(dateKey());
  await reloadTasks();
  showView('today');
}

export async function initSettings() {
  $('save-key').addEventListener('click', async () => {
    await setKv('apiKey', $('api-key').value.trim());
    $('key-status').textContent = 'המפתח נשמר במכשיר.';
  });
  $('export-btn').addEventListener('click', exportBackup);
  $('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });
  $('wipe-btn').addEventListener('click', wipeAll);
  $('api-key').value = (await getKv('apiKey')) ?? '';
}
