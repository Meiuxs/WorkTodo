import { createSearchIndexRecord } from './search-index.js';

export const DATABASE_NAME = 'worktodo';
export const DATABASE_VERSION = 3;
const TASK_RELATIONSHIP_FIELDS = ['parentId', 'tagIds', 'seriesId', 'occurrenceKey'];

const TASK_INDEXES = [
  ['scheduledDate', 'scheduledDate'],
  ['lifecycle', 'lifecycle'],
  ['completedAt', 'completedAt'],
  ['createdAt', 'createdAt'],
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
const SEARCH_INDEX_INDEXES = [
  ['grams', 'grams', { multiEntry: true }],
];

export function ensureIndexes(store, indexes) {
  for (const [name, keyPath, options] of indexes) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, options);
    }
  }
}

export function materializeTaskRelationships(task) {
  const materialized = { ...task };
  for (const field of TASK_RELATIONSHIP_FIELDS) {
    if (materialized[field] === undefined) {
      materialized[field] = field === 'tagIds' ? [] : null;
    }
  }
  return materialized;
}

function migrateTaskStore(store, searchIndex) {
  searchIndex.clear();
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    const task = TASK_RELATIONSHIP_FIELDS.some((field) => cursor.value[field] === undefined)
      ? materializeTaskRelationships(cursor.value)
      : cursor.value;
    if (task !== cursor.value) {
      cursor.update(task);
    }
    searchIndex.put(createSearchIndexRecord(task));
    cursor.continue();
  };
}

export function upgradeDatabase(database, transaction = database.transaction) {
  const tasks = database.objectStoreNames.contains('tasks')
    ? transaction.objectStore('tasks')
    : database.createObjectStore('tasks', { keyPath: 'id' });
  ensureIndexes(tasks, TASK_INDEXES);

  const searchIndex = database.objectStoreNames.contains('searchIndex')
    ? transaction.objectStore('searchIndex')
    : database.createObjectStore('searchIndex', { keyPath: 'taskId' });
  ensureIndexes(searchIndex, SEARCH_INDEX_INDEXES);
  migrateTaskStore(tasks, searchIndex);

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
