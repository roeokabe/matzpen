// Everything is stored on the device in one IndexedDB database.
// Bump the version and add stores in onupgradeneeded; never drop existing ones.
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('matzpen', 2);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'date' });
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
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

export const getEntry = (date) => store('entries', 'readonly', (s) => s.get(date));
export const putEntry = (entry) => store('entries', 'readwrite', (s) => s.put(entry));
export const allEntries = async () => (await store('entries', 'readonly', (s) => s.getAll())).sort((a, b) => b.date.localeCompare(a.date));
export const getKv = async (key) => (await store('kv', 'readonly', (s) => s.get(key)))?.value;
export const setKv = (key, value) => store('kv', 'readwrite', (s) => s.put({ key, value }));
export const putTask = (task) => store('tasks', 'readwrite', (s) => s.put(task));
export const deleteTask = (id) => store('tasks', 'readwrite', (s) => s.delete(id));
export const allTasks = () => store('tasks', 'readonly', (s) => s.getAll());
export const clearStore = (name) => store(name, 'readwrite', (s) => s.clear());
