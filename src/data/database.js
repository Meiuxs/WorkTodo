export const DATABASE_NAME = 'worktodo';
export const DATABASE_VERSION = 1;

export function openWorkTodoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('tasks')) {
        const tasks = database.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('scheduledDate', 'scheduledDate');
        tasks.createIndex('lifecycle', 'lifecycle');
        tasks.createIndex('completedAt', 'completedAt');
        tasks.createIndex('categoryId', 'categoryId');
        tasks.createIndex('trashedAt', 'trashedAt');
      }
      if (!database.objectStoreNames.contains('categories')) {
        database.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('events')) {
        const events = database.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('taskId', 'taskId');
        events.createIndex('occurredAt', 'occurredAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('WorkTodo 数据库正被其他页面占用'));
  });
}
