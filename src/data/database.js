export const DATABASE_NAME = 'worktodo';
export const DATABASE_VERSION = 2;

const TASK_INDEXES = [
  ['scheduledDate', 'scheduledDate'],
  ['lifecycle', 'lifecycle'],
  ['completedAt', 'completedAt'],
  ['categoryId', 'categoryId'],
  ['trashedAt', 'trashedAt'],
  ['parentId', 'parentId'],
  ['seriesId', 'seriesId'],
  ['occurrenceKey', 'occurrenceKey', { unique: true }],
  ['tagIds', 'tagIds', { multiEntry: true }],
];
const EVENT_INDEXES = [
  ['taskId', 'taskId'],
  ['occurredAt', 'occurredAt'],
];
const TAG_INDEXES = [['name', 'name', { unique: true }]];
const TEMPLATE_INDEXES = [['active', 'active']];

export function ensureIndexes(store, indexes) {
  for (const [name, keyPath, options] of indexes) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, options);
    }
  }
}

export function upgradeDatabase(database, transaction = database.transaction) {
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

  const tags = database.objectStoreNames.contains('tags')
    ? transaction.objectStore('tags')
    : database.createObjectStore('tags', { keyPath: 'id' });
  ensureIndexes(tags, TAG_INDEXES);

  const templates = database.objectStoreNames.contains('recurringTemplates')
    ? transaction.objectStore('recurringTemplates')
    : database.createObjectStore('recurringTemplates', { keyPath: 'id' });
  ensureIndexes(templates, TEMPLATE_INDEXES);
}

export function openWorkTodoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      upgradeDatabase(request.result, request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('WorkTodo 数据库正被其他页面占用'));
  });
}
