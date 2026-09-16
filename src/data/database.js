export const DATABASE_NAME = 'worktodo';
export const DATABASE_VERSION = 1;

const TASK_INDEXES = [
  ['scheduledDate', 'scheduledDate'],
  ['lifecycle', 'lifecycle'],
  ['completedAt', 'completedAt'],
  ['categoryId', 'categoryId'],
  ['trashedAt', 'trashedAt'],
];
const EVENT_INDEXES = [
  ['taskId', 'taskId'],
  ['occurredAt', 'occurredAt'],
];

export function ensureIndexes(store, indexes) {
  for (const [name, keyPath] of indexes) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath);
    }
  }
}

export function openWorkTodoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      const tasks = database.objectStoreNames.contains('tasks')
        ? transaction.objectStore('tasks')
        : database.createObjectStore('tasks', { keyPath: 'id' });
      ensureIndexes(tasks, TASK_INDEXES);

      if (!database.objectStoreNames.contains('categories')) {
        database.createObjectStore('categories', { keyPath: 'id' });
      }
      const events = database.objectStoreNames.contains('events')
        ? transaction.objectStore('events')
        : database.createObjectStore('events', { keyPath: 'id' });
      ensureIndexes(events, EVENT_INDEXES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('WorkTodo 数据库正被其他页面占用'));
  });
}
