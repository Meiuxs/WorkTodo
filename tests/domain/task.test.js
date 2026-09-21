import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError, TransitionError } from '../../src/domain/errors.js';
import {
  createTask,
  isInboxTask,
  nextPriority,
  transitionTask,
  validateTask,
} from '../../src/domain/task.js';
import { createTaskEvent } from '../../src/domain/task-event.js';

const NOW = '2026-09-17T08:30:00.000Z';
const BASE_TASK = {
  id: 't1',
  title: '报价',
  priority: 'none',
  categoryId: null,
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

/* 这些提示原样显示在编辑抽屉和快速记录下方。用户看到的是界面字段名，
   因此文案里不允许出现 title / startTime 这类内部字段（回归保护，见设计规范 §5.4）。 */
test('任务校验提示使用界面字段名，不暴露内部字段名', () => {
  const messageOf = (run) => {
    try {
      run();
    } catch (error) {
      return error.message;
    }
    throw new Error('预期这次调用会抛出校验错误');
  };

  const messages = [
    messageOf(() => createTask({ title: '   ' }, NOW, 't1')),
    messageOf(() => createTask({ title: '超长'.repeat(101) }, NOW, 't1')),
    messageOf(() => createTask({ title: '报价', scheduledDate: '2026-09-17', startTime: '10:00', dueTime: '09:00' }, NOW, 't1')),
    messageOf(() => createTask({ title: '报价', scheduledDate: '2026-09-17', startTime: '10:00' }, NOW, 't1')),
    messageOf(() => createTask({ title: '报价', startTime: '10:00', dueTime: '11:00' }, NOW, 't1')),
  ];

  for (const message of messages) {
    assert.doesNotMatch(message, /[A-Za-z]{3,}/, message);
    assert.match(message, /[\u4e00-\u9fa5]/, message);
  }
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
  assert.equal(task.description, '');
  assert.equal(task.starred, false);
  assert.equal(task.lifecycle, 'todo');
  assert.equal(task.priority, 'none');
  assert.equal(task.revision, 0);
  assert.equal(task.scheduledDate, null);
  assert.equal(task.firstScheduledDate, null);
  assert.equal(isInboxTask(task), true);
  assert.equal(validateTask(task), true);
});

test('V1.1 任务关系字段有稳定默认值并拒绝非法 tagIds', () => {
  const task = createTask({ title: '报价' }, NOW, 't1');
  assert.equal(task.parentId, null);
  assert.deepEqual(task.tagIds, []);
  assert.equal(task.seriesId, null);
  assert.equal(task.occurrenceKey, null);

  assert.throws(
    () => createTask({ title: '报价', tagIds: ['tag-1', 'tag-1'] }, NOW, 't2'),
    ValidationError,
  );
});

test('V1.1 任务关系字段兼容旧数据并严格校验已提供值', () => {
  assert.equal(validateTask(BASE_TASK), true);
  assert.equal(validateTask({
    ...BASE_TASK,
    parentId: 'parent-1',
    tagIds: ['tag-1'],
    seriesId: 'series-1',
    occurrenceKey: '2026-09-17',
  }), true);

  assert.throws(() => createTask({ title: '报价', tagIds: 'tag-1' }, NOW, 't2'), ValidationError);
  assert.throws(() => createTask({ title: '报价', tagIds: [''] }, NOW, 't2'), ValidationError);
  assert.throws(() => validateTask({ ...BASE_TASK, tagIds: ['tag-1', 'tag-1'] }), ValidationError);
  assert.throws(() => validateTask({ ...BASE_TASK, tagIds: ['tag-1', false] }), ValidationError);

  for (const fieldName of ['parentId', 'seriesId', 'occurrenceKey']) {
    assert.throws(() => validateTask({ ...BASE_TASK, [fieldName]: false }), ValidationError);
  }
});

test('V1.1 tagIds 拒绝稀疏数组和非法元素', () => {
  const sparseOnly = new Array(1);
  const sparseWithTag = [, 'tag-1'];

  assert.throws(
    () => createTask({ title: '报价', tagIds: sparseOnly }, NOW, 't2'),
    ValidationError,
  );
  assert.throws(
    () => createTask({ title: '报价', tagIds: sparseWithTag }, NOW, 't3'),
    ValidationError,
  );
  assert.throws(() => validateTask({ ...BASE_TASK, tagIds: sparseOnly }), ValidationError);
  assert.throws(() => validateTask({ ...BASE_TASK, tagIds: sparseWithTag }), ValidationError);

  assert.throws(
    () => createTask({ title: '报价', tagIds: [undefined] }, NOW, 't4'),
    ValidationError,
  );
  assert.throws(() => validateTask({ ...BASE_TASK, tagIds: [''] }), ValidationError);
  assert.throws(() => validateTask({ ...BASE_TASK, tagIds: [42] }), ValidationError);
});

test('重新安排回收集箱时保留首次计划日期并清空时间字段', () => {
  const task = createTask({
    title: '报价',
    scheduledDate: '2026-09-17',
    startTime: '09:00',
    dueTime: '10:00',
  }, NOW, 't1');

  const moved = transitionTask(task, { type: 'RESCHEDULE', date: null }, NOW);

  assert.equal(moved.scheduledDate, null);
  assert.equal(moved.firstScheduledDate, '2026-09-17');
  assert.equal(moved.startTime, null);
  assert.equal(moved.dueTime, null);
});

test('创建任务拒绝空标题和超过 200 字符的标题', () => {
  assert.throws(() => createTask({ title: '   ' }, NOW, 't1'), ValidationError);
  assert.throws(() => createTask({ title: 'a'.repeat(201) }, NOW, 't1'), ValidationError);
});

test('任务分类只能是分类 ID 或 null', () => {
  assert.throws(() => validateTask({ ...BASE_TASK, categoryId: false }), ValidationError);
  assert.throws(() => validateTask({ ...BASE_TASK, categoryId: { id: 'work' } }), ValidationError);
  assert.equal(validateTask({ ...BASE_TASK, categoryId: null }), true);
  assert.equal(validateTask({ ...BASE_TASK, categoryId: 'work' }), true);
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

test('优先级沿无→低→中→高循环，尾部回到无', () => {
  assert.equal(nextPriority('none'), 'low');
  assert.equal(nextPriority('low'), 'medium');
  assert.equal(nextPriority('medium'), 'high');
  assert.equal(nextPriority('high'), 'none');
  // 意外脏数据视为“无”，下一次按 P 即进入低档位，不会产出非法优先级。
  assert.equal(nextPriority('legacy'), 'low');
});
