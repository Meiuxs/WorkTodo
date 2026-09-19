const COLUMNS = ['标题', '状态', '优先级', '列表', '标签', '计划日期', '开始时间', '截止时间', '完成时间', '创建时间'];

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export class CsvExportService {
  createCsv({ tasks, categories, tags }) {
    const categoryNames = new Map(categories.map((item) => [item.id, item.name]));
    const tagNames = new Map(tags.map((item) => [item.id, item.name]));
    const rows = tasks.map((task) => [
      task.title,
      task.lifecycle,
      task.priority,
      task.categoryId === null ? '' : categoryNames.get(task.categoryId) ?? '',
      (task.tagIds ?? []).map((id) => tagNames.get(id)).filter(Boolean).join(' '),
      task.scheduledDate,
      task.startTime,
      task.dueTime,
      task.completedAt,
      task.createdAt,
    ]);
    return `\uFEFF${[COLUMNS, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
  }

  exportDownload(contents, filename) {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
}
