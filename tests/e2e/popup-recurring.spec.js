import { test, expect, openDashboard, openPopup, openEditorGroup } from './fixtures.js';

test('Popup 完成重复任务后会继续生成下一实例', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '补充详情', exact: true }).click();
  await dashboard.getByLabel('任务名称').fill('Popup 每日复盘');
  const today = await dashboard.evaluate(() => new Date().toISOString().slice(0, 10));
  await dashboard.locator('#task-editor input[name="scheduledDate"]').fill(today);
  await openEditorGroup(dashboard, 'recurring');
  await dashboard.getByLabel('按规则自动创建下一项').check();
  await dashboard.locator('#task-editor select[name="recurrenceFrequency"]').selectOption('daily');
  await dashboard.locator('#task-editor input[name="recurrenceInterval"]').fill('1');
  await dashboard.getByRole('button', { name: '保存任务', exact: true }).click();

  const popup = await openPopup(extension);
  const taskRow = popup.locator('.task-row').filter({ hasText: 'Popup 每日复盘' });
  await expect(taskRow).toBeVisible();
  await taskRow.getByRole('checkbox', { name: '完成任务' }).click();
  await expect(popup.getByText('已完成任务')).toBeVisible();

  const instances = await popup.evaluate(async () => {
    const { TaskRepository } = await import('../data/task-repository.js');
    return (await new TaskRepository().list())
      .filter((task) => task.title === 'Popup 每日复盘')
      .map((task) => ({ lifecycle: task.lifecycle, scheduledDate: task.scheduledDate }))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  });
  expect(instances).toHaveLength(2);
  expect(instances[0].lifecycle).toBe('completed');
  expect(instances[1].lifecycle).toBe('todo');
  expect(instances[1].scheduledDate).toBe(await dashboard.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }));
});
