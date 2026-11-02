const MODEL = 'claude-opus-5-5';
const TASK_COUNT = 3;
const MIN_DAYS_FOR_PATTERNS = 3;

const GUIDELINES = `כללים:
- כתיבה בעברית פשוטה, חמה וישירה, בטקסט רגיל בלי Markdown.
- ניסוח ניטרלי מבחינת מגדר (למשל "אפשר לנסות" או "כדאי לשים לב"), כי מגדר הכותב/ת לא ידוע.
- להישען רק על מה שנכתב ביומן, ולהבחין בין מה שעולה ממנו לבין השערה.
- בלי אבחנות רפואיות או נפשיות ובלי מחמאות ריקות.
- אם עולים סימני מצוקה קשה, ייאוש או מחשבות על פגיעה עצמית: להגיב בחום, לעזוב את הניתוח, ולעודד פנייה לאדם קרוב ולער"ן בטלפון 1201 (בכל שעה), או ל-101 בסכנה מיידית.`;

const DAY_SYSTEM = `התפקיד שלך הוא לשקף לאדם את יום אחד מתוך יומן אישי שהוא מנהל לעצמו. אפשר להיעזר בימים הקודמים אם הם מצורפים.
התשובה: עד 120 מילים. מה בולט ביום הזה, כוח אחד שבא בו לידי ביטוי, וצעד קטן אחד למחר.
${GUIDELINES}`;

const PATTERN_SYSTEM = `התפקיד שלך הוא לזהות דפוסים ביומן אישי של אדם, כדי לעזור לו להכיר את עצמו ולהתנהל טוב יותר.
התשובה: עד 300 מילים, בארבעה חלקים עם כותרת קצרה בשורה נפרדת: כוחות שחוזרים, חולשות ונקודות תקיעה, מה משפיע על מצב הרוח והאנרגיה, וניסוי אחד לשבוע הקרוב.
אם אין מספיק מידע לחלק מסוים, יש לומר זאת במקום לנחש.
${GUIDELINES}`;

const $ = (id) => document.getElementById(id);

// ---- Storage ----

const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('matzpen', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('entries', { keyPath: 'date' });
    req.result.createObjectStore('kv', { keyPath: 'key' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode, fn) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const getEntry = (date) => store('entries', 'readonly', (s) => s.get(date));
const putEntry = (entry) => store('entries', 'readwrite', (s) => s.put(entry));
const allEntries = async () => (await store('entries', 'readonly', (s) => s.getAll())).sort((a, b) => b.date.localeCompare(a.date));
const getKv = async (key) => (await store('kv', 'readonly', (s) => s.get(key)))?.value;
const setKv = (key, value) => store('kv', 'readwrite', (s) => s.put({ key, value }));

// ---- Dates ----

function dateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---- Entries ----

function blankEntry(date) {
  return {
    date,
    mood: null,
    energy: null,
    tasks: Array.from({ length: TASK_COUNT }, () => ({ text: '', done: false })),
    note: '',
    strength: '',
    struggle: '',
    insight: '',
  };
}

function hasContent(e) {
  return Boolean(e.mood || e.energy || e.note.trim() || e.strength.trim() || e.struggle.trim() || e.tasks.some((t) => t.text.trim()));
}

function entryToText(e) {
  const lines = [`תאריך: ${e.date}`];
  if (e.mood) lines.push(`מצב רוח: ${e.mood}/5`);
  if (e.energy) lines.push(`אנרגיה: ${e.energy}/5`);
  const tasks = e.tasks.filter((t) => t.text.trim());
  if (tasks.length) lines.push(`משימות: ${tasks.map((t) => `${t.text} (${t.done ? 'בוצע' : 'לא בוצע'})`).join('; ')}`);
  if (e.note.trim()) lines.push(`משמעותי: ${e.note.trim()}`);
  if (e.strength.trim()) lines.push(`הצלחות וכוחות: ${e.strength.trim()}`);
  if (e.struggle.trim()) lines.push(`קשיים: ${e.struggle.trim()}`);
  return lines.join('\n');
}

// ---- Today view ----

let current = blankEntry(dateKey());
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  $('save-status').textContent = '';
  saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await putEntry(current);
  $('save-status').textContent = 'נשמר במכשיר';
}

function buildScale(containerId, field) {
  const box = $(containerId);
  for (let value = 1; value <= 5; value++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = value;
    btn.addEventListener('click', () => {
      current[field] = current[field] === value ? null : value;
      renderScale(containerId, field);
      scheduleSave();
    });
    box.append(btn);
  }
}

function renderScale(containerId, field) {
  [...$(containerId).children].forEach((btn, i) => {
    btn.setAttribute('aria-pressed', String(current[field] === i + 1));
  });
}

function buildTasks() {
  for (let i = 0; i < TASK_COUNT; i++) {
    const row = document.createElement('div');
    row.className = 'task';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', `משימה ${i + 1} בוצעה`);
    const text = document.createElement('input');
    text.type = 'text';
    text.setAttribute('aria-label', `משימה ${i + 1}`);
    check.addEventListener('change', () => {
      current.tasks[i].done = check.checked;
      row.classList.toggle('done', check.checked);
      scheduleSave();
    });
    text.addEventListener('input', () => {
      current.tasks[i].text = text.value;
      scheduleSave();
    });
    row.append(check, text);
    $('tasks').append(row);
  }
}

function renderToday() {
  const isToday = current.date === dateKey();
  $('today-title').textContent = isToday ? 'היום' : 'יום קודם';
  $('today-date').textContent = formatDate(current.date);
  $('back-to-today').hidden = isToday;
  renderScale('mood-scale', 'mood');
  renderScale('energy-scale', 'energy');
  [...$('tasks').children].forEach((row, i) => {
    const [check, text] = row.children;
    check.checked = current.tasks[i].done;
    text.value = current.tasks[i].text;
    row.classList.toggle('done', current.tasks[i].done);
  });
  for (const field of ['note', 'strength', 'struggle']) $(field).value = current[field];
  $('save-status').textContent = '';
  showResult('day-insight', current.insight);
  showError('day-insight-error', '');
}

async function openDay(date) {
  await flushSave();
  current = (await getEntry(date)) ?? blankEntry(date);
  renderToday();
  showView('today');
}

// ---- Claude ----

async function askClaude(system, content) {
  const apiKey = await getKv('apiKey');
  if (!apiKey) throw new Error('כדי לקבל תובנות צריך להזין מפתח API במסך ההגדרות.');

  let response;
  try {
    // Plain fetch: the app has no build step, and this keeps it working as static files.
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch {
    throw new Error('אין חיבור לאינטרנט. מה שנכתב נשמר, ואפשר לנסות שוב אחר כך.');
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('מפתח ה-API לא תקין. אפשר לבדוק אותו במסך ההגדרות.');
    if (response.status === 402 || response.status === 403) throw new Error('החשבון לא מאפשר את הבקשה. כדאי לבדוק את היתרה וההרשאות ב-Claude Console.');
    if (response.status === 429) throw new Error('יותר מדי בקשות כרגע, או שהגעת לתקרת ההוצאה. אפשר לנסות שוב בעוד כמה דקות.');
    if (response.status >= 500) throw new Error('השירות לא זמין כרגע. אפשר לנסות שוב בעוד כמה דקות.');
    throw new Error(`הבקשה נכשלה (שגיאה ${response.status}).`);
  }

  const message = await response.json();
  if (message.stop_reason === 'refusal') throw new Error('לא התקבלה תובנה על הטקסט הזה. אם קשה עכשיו, ער"ן זמינים בכל שעה בטלפון 1201.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('התקבלה תשובה ריקה. אפשר לנסות שוב.');
  return text;
}

function showResult(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function showError(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

async function withBusy(btn, busyLabel, errorId, fn) {
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

async function dayInsight() {
  if (!hasContent(current)) throw new Error('כדאי למלא קודם משהו מהיום.');
  await flushSave();
  const date = current.date;
  const previous = (await allEntries()).filter((e) => e.date < date && hasContent(e)).slice(0, 7);
  const parts = [`היום שעליו מבקשים תובנה:\n${entryToText(current)}`];
  if (previous.length) parts.push(`ימים קודמים, להקשר בלבד:\n${previous.map(entryToText).join('\n\n')}`);
  const insight = await askClaude(DAY_SYSTEM, parts.join('\n\n---\n\n'));
  if (current.date === date) {
    current.insight = insight;
    showResult('day-insight', insight);
    await putEntry(current);
  } else {
    const entry = await getEntry(date);
    await putEntry({ ...entry, insight });
  }
}

async function runPatterns() {
  await flushSave();
  const entries = (await allEntries()).filter(hasContent).slice(0, 30);
  if (entries.length < MIN_DAYS_FOR_PATTERNS) {
    throw new Error(`צריך לפחות ${MIN_DAYS_FOR_PATTERNS} ימים ביומן כדי לזהות דפוסים. עד עכשיו: ${entries.length}.`);
  }
  const text = await askClaude(PATTERN_SYSTEM, [...entries].reverse().map(entryToText).join('\n\n'));
  const pattern = { text, date: dateKey(), days: entries.length };
  await setKv('pattern', pattern);
  renderPattern(pattern);
}

function renderPattern(pattern) {
  showResult('pattern', pattern?.text ?? '');
  $('pattern-meta').hidden = !pattern;
  if (pattern) $('pattern-meta').textContent = `נותח ב-${formatDate(pattern.date)}, על סמך ${pattern.days} ימים`;
}

// ---- History ----

function renderChart(entries) {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const box = $('mood-chart');
  box.replaceChildren();
  for (let back = 13; back >= 0; back--) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const key = dateKey(d);
    const mood = byDate.get(key)?.mood;
    const bar = document.createElement('div');
    if (mood) bar.style.height = `${mood * 20}%`;
    else bar.className = 'empty';
    bar.title = mood ? `${formatDate(key)}: ${mood}` : formatDate(key);
    box.append(bar);
  }
}

async function renderHistory() {
  await flushSave();
  const entries = (await allEntries()).filter(hasContent);
  renderChart(entries);
  const list = $('history-list');
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'עדיין אין ימים ביומן. הם יופיעו כאן אחרי המילוי הראשון.';
    list.append(empty);
    return;
  }
  for (const e of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    const title = document.createElement('strong');
    title.textContent = formatDate(e.date);
    const scores = [e.mood && `מצב רוח ${e.mood}`, e.energy && `אנרגיה ${e.energy}`].filter(Boolean).join(' · ');
    const detail = document.createElement('span');
    detail.textContent = [scores, e.note.trim()].filter(Boolean).join(' · ');
    btn.append(title, detail);
    btn.addEventListener('click', () => openDay(e.date));
    list.append(btn);
  }
}

// ---- Settings ----

async function exportBackup() {
  await flushSave();
  const data = { app: 'matzpen', version: 1, exportedAt: new Date().toISOString(), entries: await allEntries(), pattern: await getKv('pattern') };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `matzpen-backup-${dateKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  $('backup-status').textContent = 'הגיבוי ירד. המפתח לא נכלל בו.';
}

function isValidEntry(e) {
  return /^\d{4}-\d{2}-\d{2}$/.test(e?.date) && Array.isArray(e.tasks) && e.tasks.length === TASK_COUNT;
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'matzpen' || !Array.isArray(data.entries) || !data.entries.every(isValidEntry)) throw new Error('bad backup');
    if (!confirm(`לשחזר ${data.entries.length} ימים? ימים עם אותו תאריך יוחלפו.`)) return;
    await flushSave();
    for (const entry of data.entries) await putEntry({ ...blankEntry(entry.date), ...entry });
    if (data.pattern) await setKv('pattern', data.pattern);
    current = (await getEntry(current.date)) ?? blankEntry(current.date);
    renderToday();
    renderPattern(await getKv('pattern'));
    $('backup-status').textContent = 'השחזור הושלם.';
  } catch {
    $('backup-status').textContent = 'הקובץ הזה לא נראה כמו גיבוי של מצפן.';
  }
}

async function wipeAll() {
  if (!confirm('למחוק את כל הימים, התובנות והמפתח מהמכשיר? אי אפשר לבטל את זה.')) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await store('entries', 'readwrite', (s) => s.clear());
  await store('kv', 'readwrite', (s) => s.clear());
  current = blankEntry(dateKey());
  $('api-key').value = '';
  renderToday();
  renderPattern(null);
  showView('today');
}

// ---- Navigation ----

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.tabs button').forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (name === 'history') renderHistory();
}

// ---- Startup ----

async function init() {
  buildScale('mood-scale', 'mood');
  buildScale('energy-scale', 'energy');
  buildTasks();

  for (const field of ['note', 'strength', 'struggle']) {
    $(field).addEventListener('input', () => {
      current[field] = $(field).value;
      scheduleSave();
    });
  }

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', async () => {
      await flushSave();
      if (b.dataset.view === 'today' && current.date !== dateKey()) await openDay(dateKey());
      else showView(b.dataset.view);
    });
  });
  $('back-to-today').addEventListener('click', () => openDay(dateKey()));

  $('day-insight-btn').addEventListener('click', (e) => withBusy(e.currentTarget, 'רגע אחד…', 'day-insight-error', dayInsight));
  $('pattern-btn').addEventListener('click', (e) => withBusy(e.currentTarget, 'הניתוח עשוי לקחת דקה…', 'pattern-error', runPatterns));

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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
    else if (saveTimer === null && $('back-to-today').hidden && current.date !== dateKey()) openDay(dateKey());
  });

  current = (await getEntry(dateKey())) ?? blankEntry(dateKey());
  renderToday();
  $('api-key').value = (await getKv('apiKey')) ?? '';
  renderPattern(await getKv('pattern'));

  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}

init();
