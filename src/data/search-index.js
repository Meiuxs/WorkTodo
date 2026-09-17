export function normalizeSearchQuery(text) {
  return (text ?? '').trim().toLocaleLowerCase();
}

export function normalizeSearchText(title, description = '') {
  return `${title ?? ''}\n${description ?? ''}`.toLocaleLowerCase();
}

export function createSearchGrams(title, description = '') {
  const characters = Array.from(normalizeSearchText(title, description));
  const grams = new Set();

  for (let index = 0; index < characters.length; index += 1) {
    grams.add(characters[index]);
    if (index + 1 < characters.length) {
      grams.add(`${characters[index]}${characters[index + 1]}`);
    }
  }

  return [...grams];
}

export function querySearchGrams(text) {
  const characters = Array.from(normalizeSearchQuery(text));
  if (characters.length === 0) return [];
  if (characters.length === 1) return [characters[0]];

  const grams = new Set();
  for (let index = 0; index + 1 < characters.length; index += 1) {
    grams.add(`${characters[index]}${characters[index + 1]}`);
  }
  return [...grams];
}

export function createSearchIndexRecord(task) {
  return {
    taskId: task.id,
    grams: createSearchGrams(task.title, task.description),
    revision: task.revision ?? null,
  };
}
