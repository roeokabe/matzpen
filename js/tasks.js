// The tasks screen: free-text tasks that Claude names, sorts into topics, and rates.
import { $, dateKey, formatDate, showError } from './util.js';
import { putTask, deleteTask, allTasks } from './db.js';
import { askClaude } from './claude.js';

const DEFAULT_TOPICS = ['עבודה', 'בית', 'משפחה', 'בריאות', 'כספים', 'אישי'];
const LEVELS = { low: 1, medium: 2, high: 3 };
const LEVEL_NAMES = ['', 'נמוכה', 'בינונית', 'גבוהה'];
const NO_TOPIC = 'ללא נושא';

const TASK_SYSTEM = `התפקיד שלך הוא לסדר משימה שאדם כתב לעצמו בשפה חופשית, ברשימת המשימות האישית שלו.
- title: שם קצר וקולע בעברית, 2 עד 5 מילים, שמתאר את הפעולה (למשל "לחדש ביטוח רכב" או "תור לרופא שיניים"). בלי נקודה בסוף.
- topic: הנושא שהמשימה שייכת אליו. עדיף לבחור נושא מהרשימה הקיימת, בדיוק באותו כתיב. נושא חדש רק אם אף נושא קיים לא מתאים, במילה אחת או שתיים.
- importance: עד כמה המשימה משמעותית לחיים, לעבודה או לאנשים הקרובים: low, medium או high.
- urgency: עד כמה היא לחוצה בזמן: low, medium או high. מילים כמו "היום", "מחר", "דחוף" או תאריך קרוב מעלות את הדחיפות.
אם הטקסט לא מספיק ברור כדי לדרג, יש לבחור medium.`;

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'topic', 'importance', 'urgency'],
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    importance: { type: 'string', enum: ['low', 'medium', 'high'] },
    urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};

let taskList = [];
let activeTopic = null;
const pendingAi = new Set();
let draft = null;

// Importance weighs more than urgency, so "important, not urgent" outranks "urgent, not important".
const score = (t) => t.importance * 2 + t.urgency;
const byPriority = (a, b) => score(b) - score(a) || a.createdAt - b.createdAt;
const priorityLevel = (t) => (score(t) >= 8 ? 'high' : score(t) >= 6 ? 'mid' : 'low');
const topicName = (t) => t.topic || NO_TOPIC;

function topicHue(name) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return hue;
}

function knownTopics() {
  return [...new Set([...DEFAULT_TOPICS, ...taskList.map((t) => t.topic).filter(Boolean)])];
}

function fallbackTitle(text) {
  const words = text.trim().split(/\s+/);
  return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
}

function dots(level) {
  return '●'.repeat(level) + '○'.repeat(3 - level);
}

export function isValidTask(t) {
  const level = (n) => [1, 2, 3].includes(n);
  return typeof t?.id === 'string' && typeof t.title === 'string' && typeof t.description === 'string'
    && typeof t.topic === 'string' && level(t.importance) && level(t.urgency);
}

// Fills in fields that older backups may lack.
export function normalizeTask(task) {
  return { done: false, doneAt: null, createdAt: Date.now(), needsAi: false, edited: false, ...task };
}

// ---- List ----

function topicPill(name) {
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.style.setProperty('--h', topicHue(name));
  pill.textContent = name;
  return pill;
}

function taskRow(task) {
  const row = document.createElement('div');
  row.className = `task-item prio-${priorityLevel(task)}${task.done ? ' is-done' : ''}`;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.setAttribute('aria-pressed', String(task.done));
  check.setAttribute('aria-label', task.done ? `החזרת "${task.title}" לרשימה` : `סימון "${task.title}" כבוצעה`);
  check.addEventListener('click', () => toggleDone(task.id, row));

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'task-main';
  const title = document.createElement('strong');
  title.textContent = task.title;
  const meta = document.createElement('span');
  meta.className = 'meta';
  if (pendingAi.has(task.id)) {
    title.classList.add('pending');
    const note = document.createElement('span');
    note.className = 'working';
    note.textContent = 'Claude מסדר את המשימה…';
    meta.append(note);
  } else {
    meta.append(topicPill(topicName(task)));
    const levels = document.createElement('span');
    levels.className = 'levels';
    levels.setAttribute('aria-label', `חשיבות ${LEVEL_NAMES[task.importance]}, דחיפות ${LEVEL_NAMES[task.urgency]}`);
    levels.textContent = `חשיבות ${dots(task.importance)} · דחיפות ${dots(task.urgency)}`;
    meta.append(levels);
  }
  main.append(title, meta);
  main.addEventListener('click', () => openTask(task.id));

  row.append(check, main);
  return row;
}

function renderTasks() {
  const open = taskList.filter((t) => !t.done).sort(byPriority);
  const done = taskList.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);

  const counts = new Map();
  for (const t of open) counts.set(topicName(t), (counts.get(topicName(t)) ?? 0) + 1);
  if (activeTopic && !counts.has(activeTopic)) activeTopic = null;

  const urgent = open.filter((t) => t.urgency === 3).length;
  const openText = open.length === 1 ? 'משימה פתוחה אחת' : `${open.length} משימות פתוחות`;
  const urgentText = urgent === 1 ? 'אחת דחופה' : `${urgent} דחופות`;
  $('tasks-summary').textContent = open.length ? [openText, urgent && urgentText].filter(Boolean).join(' · ') : 'הרשימה ריקה';

  const filter = $('topic-filter');
  filter.replaceChildren();
  filter.hidden = counts.size < 2;
  const chips = [[null, 'הכול', open.length], ...[...counts].sort((a, b) => b[1] - a[1]).map(([name, n]) => [name, name, n])];
  for (const [value, label, n] of chips) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    if (value) chip.style.setProperty('--h', topicHue(value));
    chip.setAttribute('aria-pressed', String(activeTopic === value));
    chip.textContent = `${label} ${n}`;
    chip.addEventListener('click', () => {
      activeTopic = value;
      renderTasks();
    });
    filter.append(chip);
  }

  const list = $('task-list');
  list.replaceChildren();
  const visible = activeTopic ? open.filter((t) => topicName(t) === activeTopic) : open;
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const head = document.createElement('strong');
    head.textContent = done.length ? 'אין משימות פתוחות' : 'עוד אין משימות';
    const body = document.createElement('p');
    body.textContent = done.length
      ? 'כל מה שהיה ברשימה בוצע. זמן טוב לנשום.'
      : 'אפשר לכתוב למעלה כל דבר שמעסיק את הראש, ו-Claude ייתן לו שם קצר וישייך אותו לנושא.';
    empty.append(head, body);
    list.append(empty);
  }
  for (const t of visible) list.append(taskRow(t));

  $('done-section').hidden = !done.length;
  $('done-summary').textContent = `בוצעו (${done.length})`;
  $('done-list').replaceChildren(...done.map(taskRow));
}

// ---- Adding and classifying ----

async function addTask() {
  const text = $('task-input').value.trim();
  if (!text) {
    $('task-input').focus();
    return;
  }
  const task = {
    id: crypto.randomUUID(),
    title: fallbackTitle(text),
    description: text,
    topic: '',
    importance: 2,
    urgency: 2,
    done: false,
    doneAt: null,
    createdAt: Date.now(),
    needsAi: true,
    edited: false,
  };
  taskList.push(task);
  await putTask(task);
  $('task-input').value = '';
  activeTopic = null;
  showError('task-add-error', '');
  classifyTask(task.id);
}

async function classifyTask(id, force = false) {
  const task = taskList.find((t) => t.id === id);
  if (!task) return;
  pendingAi.add(id);
  renderTasks();
  try {
    const content = `התאריך היום: ${dateKey()}\nנושאים קיימים: ${knownTopics().join(', ')}\n\nהמשימה כפי שנכתבה:\n${task.description}`;
    let result;
    try {
      result = JSON.parse(await askClaude(TASK_SYSTEM, content, { effort: 'low', schema: TASK_SCHEMA }));
    } catch (err) {
      throw err instanceof SyntaxError ? new Error('התקבלה תשובה לא צפויה.') : err;
    }
    const latest = taskList.find((t) => t.id === id);
    if (latest && (force || !latest.edited)) {
      latest.title = result.title.trim() || latest.title;
      latest.topic = result.topic.trim();
      latest.importance = LEVELS[result.importance] ?? 2;
      latest.urgency = LEVELS[result.urgency] ?? 2;
      latest.needsAi = false;
      await putTask(latest);
    }
  } catch (err) {
    showError('task-add-error', `המשימה נשמרה, אבל בלי שם ונושא אוטומטיים. ${err.message}`);
  } finally {
    pendingAi.delete(id);
    renderTasks();
  }
}

async function toggleDone(id, row) {
  const task = taskList.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  await putTask(task);
  if (row && task.done && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    row.classList.add('leaving');
    await new Promise((r) => setTimeout(r, 260));
  }
  renderTasks();
}

// ---- Detail sheet ----

function buildSegmented(containerId, field) {
  const box = $(containerId);
  for (let level = 1; level <= 3; level++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = LEVEL_NAMES[level];
    btn.addEventListener('click', () => {
      draft[field] = level;
      renderSegmented(containerId, field);
    });
    box.append(btn);
  }
}

function renderSegmented(containerId, field) {
  [...$(containerId).children].forEach((btn, i) => btn.setAttribute('aria-pressed', String(draft[field] === i + 1)));
}

function openTask(id) {
  const task = taskList.find((t) => t.id === id);
  if (!task) return;
  draft = { id, original: { ...task }, importance: task.importance, urgency: task.urgency, done: task.done, deleted: false, classify: false };
  $('td-title').value = task.title;
  $('td-description').value = task.description;
  $('td-topic').value = task.topic;
  $('topic-options').replaceChildren(...knownTopics().map((name) => Object.assign(document.createElement('option'), { value: name })));
  renderSegmented('td-importance', 'importance');
  renderSegmented('td-urgency', 'urgency');
  $('td-meta').textContent = `נוספה ב-${formatDate(dateKey(new Date(task.createdAt)))}`;
  $('td-done').textContent = task.done ? 'החזרה לרשימה' : 'סימון כבוצעה';
  $('td-ai').hidden = pendingAi.has(id);
  $('task-dialog').showModal();
}

async function closeTask() {
  if (!draft) return;
  const { id, original } = draft;
  const finished = draft;
  draft = null;
  const task = taskList.find((t) => t.id === id);
  if (!task) return renderTasks();

  if (finished.deleted) {
    taskList = taskList.filter((t) => t.id !== id);
    await deleteTask(id);
    return renderTasks();
  }

  // Apply only fields changed in the sheet, so a classification that finished meanwhile is kept.
  const edits = {
    title: $('td-title').value.trim() || original.title,
    description: $('td-description').value.trim() || original.description,
    topic: $('td-topic').value.trim(),
    importance: finished.importance,
    urgency: finished.urgency,
  };
  let changed = false;
  for (const [field, value] of Object.entries(edits)) {
    if (value !== original[field]) {
      task[field] = value;
      changed = true;
    }
  }
  if (changed) task.edited = true;
  if (finished.done !== original.done) {
    task.done = finished.done;
    task.doneAt = task.done ? Date.now() : null;
  }
  await putTask(task);
  renderTasks();
  if (finished.classify) classifyTask(id, true);
}

// ---- Setup ----

export async function reloadTasks() {
  taskList = await allTasks();
  renderTasks();
}

export async function initTasks() {
  buildSegmented('td-importance', 'importance');
  buildSegmented('td-urgency', 'urgency');

  $('task-add').addEventListener('click', addTask);
  $('task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addTask();
    }
  });

  const dialog = $('task-dialog');
  dialog.addEventListener('close', closeTask);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('td-close').addEventListener('click', () => dialog.close());
  $('td-done').addEventListener('click', () => {
    draft.done = !draft.done;
    dialog.close();
  });
  $('td-ai').addEventListener('click', () => {
    draft.classify = true;
    dialog.close();
  });
  $('td-delete').addEventListener('click', () => {
    if (!confirm('למחוק את המשימה?')) return;
    draft.deleted = true;
    dialog.close();
  });

  await reloadTasks();
}
