import {
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from '../domain/dates.js';

function rateText(rate) {
  return rate === null ? '暂无计划' : `${Math.round(rate * 100)}%`;
}

function plainTitle(title) {
  const text = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length === 0 ? '未命名任务' : text;
}

function format({ title, rangeText, stats, completedTasks }) {
  const completed = completedTasks
    .map((task) => `- ${plainTitle(task.title)}`)
    .join('\n');
  return `${title}（${rangeText}）
实际完成 ${stats.completedCount} 项，计划任务 ${stats.plannedCount} 项，延期 ${stats.postponedCount} 次，完成率 ${rateText(stats.completionRate)}。
计划并完成 ${stats.plannedCompletedCount} 项，历史延期完成 ${stats.carriedOverCompletedCount} 项。

实际完成明细：
${completed.length === 0 ? '- 暂无' : completed}`;
}

export class SummaryService {
  constructor({ statistics, query }) {
    this.statistics = statistics;
    this.query = query;
  }

  async weekly(anchorDate) {
    const startDate = startOfWeek(anchorDate);
    const endDate = endOfWeek(anchorDate);
    const rangeText = `${startDate} 至 ${endDate}`;
    const [stats, completedTasks] = await Promise.all([
      this.statistics.weekly(startDate),
      this.query.completed({ completedFrom: startDate, completedTo: endDate }),
    ]);
    return {
      kind: 'week',
      title: '本周总结',
      rangeText,
      stats,
      completedTasks,
      text: format({ title: '本周总结', rangeText, stats, completedTasks }),
    };
  }

  async monthly(anchorDate) {
    const startDate = startOfMonth(anchorDate);
    const endDate = endOfMonth(anchorDate);
    const rangeText = `${startDate} 至 ${endDate}`;
    const [stats, completedTasks] = await Promise.all([
      this.statistics.monthly(anchorDate),
      this.query.completed({ completedFrom: startDate, completedTo: endDate }),
    ]);
    return {
      kind: 'month',
      title: '本月总结',
      rangeText,
      stats,
      completedTasks,
      text: format({ title: '本月总结', rangeText, stats, completedTasks }),
    };
  }

  async copyText(text) {
    await navigator.clipboard.writeText(text);
  }
}
