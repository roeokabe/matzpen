// Matzpen: the daily check-in, its history, and the pattern analysis.
import { $, dateKey, formatDate, showResult, showError, withBusy } from './util.js';
import { getEntry, putEntry, allEntries, getKv, setKv } from './db.js';
import { askClaude } from './claude.js';
import { onShow, showView } from './nav.js';

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

// ---- Entries ----

export function blankEntry(date) {
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

export function isValidEntry(e) {
  return /^\d{4}-\d{2}-\d{2}$/.test(e?.date) && Array.isArray(e.tasks) && e.tasks.length === TASK_COUNT;
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

export async function flushSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await putEntry(current);
  $('save-status').textContent = 'נשמר במכשיר';
}

export function discardPendingSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
}

export const isShowingToday = () => current.date === dateKey();

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

function buildDailyTasks() {
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
  const isToday = isShowingToday();
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

export async function openDay(date) {
  await flushSave();
  current = (await getEntry(date)) ?? blankEntry(date);
  renderToday();
  showView('today');
}

// ---- Insights ----

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

// ---- Setup ----

// Reloads the shown day and the saved pattern from storage, after a restore or wipe.
export async function reloadCheckin(date = current.date) {
  current = (await getEntry(date)) ?? blankEntry(date);
  renderToday();
  renderPattern(await getKv('pattern'));
}

export async function initCheckin() {
  buildScale('mood-scale', 'mood');
  buildScale('energy-scale', 'energy');
  buildDailyTasks();

  for (const field of ['note', 'strength', 'struggle']) {
    $(field).addEventListener('input', () => {
      current[field] = $(field).value;
      scheduleSave();
    });
  }
  $('back-to-today').addEventListener('click', () => openDay(dateKey()));
  $('day-insight-btn').addEventListener('click', (e) => withBusy(e.currentTarget, 'רגע אחד…', 'day-insight-error', dayInsight));
  $('pattern-btn').addEventListener('click', (e) => withBusy(e.currentTarget, 'הניתוח עשוי לקחת דקה…', 'pattern-error', runPatterns));
  onShow('history', renderHistory);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
    else if (saveTimer === null && $('back-to-today').hidden && !isShowingToday()) openDay(dateKey());
  });

  await reloadCheckin(dateKey());
}
