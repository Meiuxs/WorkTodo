import {
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from '../domain/dates.js';

const HTML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?\s*\/?>/g;
const URI_SCHEME_PATTERN = /\b(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+|(?:mailto|tel|sms|file|data|javascript|geo|urn):[^\s]+|[A-Za-z][A-Za-z0-9+.-]*:(?![0-9]+(?:\.[0-9]+)*\b)[^\s]+)/gi;
const IPV4_PATTERN = /\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}(?::\d{1,5})?(?:[/?#][^\s]*)?\b/g;
const DOMAIN_PATTERN = /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:com|cn|net|org|io|co|me|app|dev|edu|gov|info|biz|xyz|tech|ai)(?::\d{1,5})?(?:[/?#][^\s]*)?(?![A-Za-z0-9-])/gi;

function rateText(rate) {
  return rate === null ? '暂无计划' : `${Math.round(rate * 100)}%`;
}

function plainTitle(title) {
  const text = String(title ?? '')
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(URI_SCHEME_PATTERN, '[链接已移除]')
    .replace(IPV4_PATTERN, '[链接已移除]')
    .replace(DOMAIN_PATTERN, '[链接已移除]')
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
