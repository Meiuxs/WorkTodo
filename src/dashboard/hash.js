/* Hash 是视图状态的唯一来源：路由、筛选和工作记录范围都写进 `#/route?k=v`，
   刷新、前进后退和收藏都能回到离开时的位置。写入一律用 replaceState，
   避免每次改一个筛选条件就往历史栈里塞一条记录。 */

export const DEFAULT_ROUTE = 'today';

const FILTER_KEYS = Object.freeze([
  'text',
  'lifecycle',
  'fromDate',
  'toDate',
  'categoryId',
  'tagId',
  'priority',
  'starred',
  'hasResources',
]);

const HISTORY_KEYS = Object.freeze(['mode', 'date']);

function currentEntries() {
  const raw = String(globalThis.location?.hash ?? '');
  const queryIndex = raw.indexOf('?');
  const path = queryIndex === -1 ? raw.slice(1) : raw.slice(1, queryIndex);
  const route = path.replace(/^\//, '');
  const params = new URLSearchParams(queryIndex === -1 ? '' : raw.slice(queryIndex + 1));
  return { route, params };
}

export function readRoute() {
  return currentEntries().route;
}

export function readViewSection() {
  return currentEntries().params.get('section');
}

function pick(params, keys) {
  const state = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value.length > 0) state[key] = value;
  }
  return state;
}

export function readFilters() {
  return pick(currentEntries().params, FILTER_KEYS);
}

export function readHistoryState() {
  return pick(currentEntries().params, HISTORY_KEYS);
}

function writeHash(path, params) {
  const query = params.toString();
  const next = `#${path}${query.length === 0 ? '' : `?${query}`}`;
  /* Node 单测等无历史栈的环境里写入是空操作，读取侧已有可选链兼容。 */
  if (globalThis.history?.replaceState === undefined) return;
  if (next === globalThis.location.hash) return;
  globalThis.history.replaceState(null, '', next);
}

export function writeRoute(route) {
  const { params } = currentEntries();
  writeHash(`/${route}`, params);
}

/* 只更新查询段、不动路径：视图同步自己的子状态（筛选、记录范围）时使用，
   路径保持当前值以免和控制器正在进行的路由切换互相覆盖。 */
export function writeParams(entries) {
  const { route } = currentEntries();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      params.set(key, String(value));
    }
  }
  writeHash(`/${route || DEFAULT_ROUTE}`, params);
}
