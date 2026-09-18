import { formatLocalDay } from '../domain/dates.js';

export const NAV_GROUPS = Object.freeze([
  Object.freeze({ id: 'today', label: '今天', routes: ['today'] }),
  Object.freeze({ id: 'planning', label: '计划', routes: ['tomorrow', 'week', 'month'] }),
  Object.freeze({ id: 'tasks', label: '任务', routes: ['inbox', 'resources', 'all', 'completed', 'trash'] }),
  Object.freeze({ id: 'review', label: '回顾', routes: ['history'] }),
  Object.freeze({ id: 'system', label: '系统', routes: ['settings'] }),
]);

export function getQuickAddFeedback({ scheduledDate = null } = {}) {
  return {
    message: scheduledDate === null ? '已添加到收集箱' : `已安排到 ${formatLocalDay(scheduledDate)}`,
    nextAction: '打开工作台',
  };
}

export function shouldShowSummaryEditor(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
