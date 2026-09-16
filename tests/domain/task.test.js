import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError, TransitionError } from '../../src/domain/errors.js';
import {
  createTask,
  isInboxTask,
  transitionTask,
  validateTask,
} from '../../src/domain/task.js';
import { createTaskEvent } from '../../src/domain/task-event.js';

const NOW = '2026-09-17T08:30:00.000Z';
const BASE_TASK = {
  id: 't1',
  title: '报价',
  priority: 'none',
  scheduledDate: '2026-09-17',
  firstScheduledDate: '2026-09-17',
  startTime: null,
  dueTime: null,
  lifecycle: 'todo',
  revision: 0,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  trashedAt: null,
};

test('首次安排日期写入不可变的 firstScheduledDate', () => {
  const task = createTask({ title: '报价', scheduledDate: '2026-09-17' }, NOW, 't1');
  assert.equal(task.firstScheduledDate, '2026-09-17');

  const moved = transitionTask(task, { type: 'RESCHEDULE', date: '2026-09-18' }, NOW);
  assert.equal(moved.scheduledDate, '2026-09-18');
  assert.equal(moved.firstScheduledDate, '2026-09-17');
  assert.notStrictEqual(moved, task);
});

test('收集箱任务不能携带时间字段', () => {
  assert.throws(
    () => createTask({ title: '临时事项', startTime: '09:00' }, NOW, 't1'),
    ValidationError,
  );
});

test('已完成任务恢复为 todo 并清空 completedAt', () => {
  const restored = transitionTask(
    { ...BASE_TASK, lifecycle: 'completed', completedAt: NOW },
    { type: 'RESTORE' },
    NOW,
  );
  assert.equal(restored.lifecycle, 'todo');
  assert.equal(restored.completedAt, null);
});

test('创建任务会修剪标题并提供稳定默认值', () => {
  const task = createTask({ title: '  跟进客户  ' }, NOW, 't2');
  assert.equal(task.title, '跟进客户');
  assert.equal(task.lifecycle, 'todo');
  assert.equal(task.priority, 'none');
  assert.equal(task.revision, 0);
  assert.equal(task.scheduledDate, null);
  assert.equal(task.firstScheduledDate, null);
  assert.equal(isInboxTask(task), true);
  assert.equal(validateTask(task), true);
});

test('创建任务拒绝空标题和超过 200 字符的标题', () => {
  assert.throws(() => createTask({ title: '   ' }, NOW, 't1'), ValidationError);
  assert.throws(() => createTask({ title: 'a'.repeat(201) }, NOW, 't1'), ValidationError);
});

test('完成、取消和回收站操作更新相应状态且增加 revision', () => {
  const completed = transitionTask(BASE_TASK, { type: 'COMPLETE' }, NOW);
  assert.equal(completed.lifecycle, 'completed');
  assert.equal(completed.completedAt, NOW);
  assert.equal(completed.revision, 1);

  const cancelled = transitionTask(BASE_TASK, { type: 'CANCEL' }, NOW);
  assert.equal(cancelled.lifecycle, 'cancelled');

  const trashed = transitionTask(BASE_TASK, { type: 'TRASH' }, NOW);
  assert.equal(trashed.trashedAt, NOW);
  const untrashed = transitionTask(trashed, { type: 'UNTRASH' }, NOW);
  assert.equal(untrashed.trashedAt, null);
});

test('开始任务进入 in_progress 并增加 revision', () => {
  const started = transitionTask(BASE_TASK, { type: 'START' }, NOW);
  assert.equal(started.lifecycle, 'in_progress');
  assert.equal(started.revision, 1);
  assert.equal(started.updatedAt, NOW);
  assert.notStrictEqual(started, BASE_TASK);
});

test('延期必须晚于当前日期，改期可以前后移动', () => {
  assert.throws(
    () => transitionTask(BASE_TASK, { type: 'POSTPONE', date: '2026-09-17' }, NOW),
    ValidationError,
  );
  const postponed = transitionTask(BASE_TASK, { type: 'POSTPONE', date: '2026-09-18' }, NOW);
  assert.equal(postponed.scheduledDate, '2026-09-18');
  assert.equal(postponed.firstScheduledDate, '2026-09-17');
  const rescheduled = transitionTask(BASE_TASK, { type: 'RESCHEDULE', date: '2026-09-16' }, NOW);
  assert.equal(rescheduled.scheduledDate, '2026-09-16');
  assert.equal(rescheduled.firstScheduledDate, '2026-09-17');
});

test('收集箱任务不能延期', () => {
  const inboxTask = createTask({ title: '未安排事项' }, NOW, 'inbox-1');
  assert.throws(
    () => transitionTask(inboxTask, { type: 'POSTPONE', date: '2026-09-18' }, NOW),
    ValidationError,
  );
});

test('不支持或不合法的状态迁移被拒绝', () => {
  assert.throws(
    () => transitionTask(BASE_TASK, { type: 'UNKNOWN' }, NOW),
    TransitionError,
  );
  assert.throws(
    () => transitionTask(
      { ...BASE_TASK, lifecycle: 'completed', completedAt: NOW },
      { type: 'START' },
      NOW,
    ),
    TransitionError,
  );
});

test('任务事件保留输入数据但不复用 detail 引用', () => {
  const detail = { source: 'popup' };
  const event = createTaskEvent({
    id: 'e1',
    taskId: 't1',
    type: 'TASK_CREATED',
    occurredAt: NOW,
    detail,
  });
  assert.deepEqual(event, { id: 'e1', taskId: 't1', type: 'TASK_CREATED', occurredAt: NOW, detail });
  assert.notStrictEqual(event.detail, detail);
});

test('任务事件拒绝缺失或空白的必填字段', () => {
  const validEvent = {
    id: 'e1',
    taskId: 't1',
    type: 'TASK_CREATED',
    occurredAt: NOW,
  };

  for (const fieldName of ['id', 'taskId', 'type', 'occurredAt']) {
    assert.throws(
      () => createTaskEvent({ ...validEvent, [fieldName]: '' }),
      ValidationError,
      `${fieldName} 为空时应被拒绝`,
    );
    assert.throws(
      () => createTaskEvent({ ...validEvent, [fieldName]: undefined }),
      ValidationError,
      `${fieldName} 缺失时应被拒绝`,
    );
  }
});
