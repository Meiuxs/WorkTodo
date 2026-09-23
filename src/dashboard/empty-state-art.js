/* 空状态视觉锚点：手写的内联 SVG 线框插画，离线 MV3 无 CDN/网络依赖。
   配色只走设计令牌——描边用容器 currentColor（CSS 里设为 --art-line），
   浅底用 --art-fill、强调用 --art-accent，随深浅主题自动切换。
   全部 aria-hidden，页面状态与说明仍由空状态文字承载，插画只是装饰。 */

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
const SOFT = 'style="fill: var(--art-fill)"';
const ACCENT_STROKE = 'style="stroke: var(--art-accent)"; fill="none"; stroke-width="3"; stroke-linecap="round"; stroke-linejoin="round"';
const ACCENT_FILL = 'style="fill: var(--art-accent)"';

function svg(body) {
  return `<svg class="empty-state__art" viewBox="0 0 120 96" aria-hidden="true" focusable="false" ${STROKE}>${body}</svg>`;
}

const motifs = {
  // 今天：地平线上升起的一轮太阳，寓意"新的一天从这里开始"。
  sun: () => svg(`
    <circle cx="60" cy="52" r="18" ${SOFT}/>
    <circle cx="60" cy="52" r="18"/>
    <path d="M60 20v-8M84 30l6-6M92 52h8M36 30l-6-6M28 52h-8"/>
    <path d="M22 72h76" ${ACCENT_STROKE}/>
  `),
  // 明天/本周：日历里高亮一格，指向"下一个要安排的日子"。
  calendar: () => svg(`
    <rect x="26" y="26" width="68" height="52" rx="6" ${SOFT}/>
    <rect x="26" y="26" width="68" height="52" rx="6"/>
    <path d="M26 40h68M42 20v12M78 20v12"/>
    <rect x="52" y="50" width="16" height="14" rx="2" ${ACCENT_FILL} stroke="none"/>
  `),
  // 收集箱：开口的收件盘加一支放入的箭头，传达"先记进来"。
  tray: () => svg(`
    <path d="M24 46h20l6 10h20l6-10h20v24a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" ${SOFT}/>
    <path d="M24 46h20l6 10h20l6-10h20v24a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z"/>
    <path d="M60 16v20M52 28l8 8 8-8" ${ACCENT_STROKE}/>
  `),
  // 已完成：一只打了勾的收纳盒，呼应"完成的事项归档在这里"。
  'done-box': () => svg(`
    <path d="M28 40h64v34a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4z" ${SOFT}/>
    <path d="M28 40h64v34a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4z"/>
    <path d="M22 40l8-16h60l8 16"/>
    <path d="M48 58l8 8 18-18" ${ACCENT_STROKE}/>
  `),
  // 今日清零：冒着热气的杯子和勾，传达"事情做完了，可以休息"。
  celebrate: () => svg(`
    <path d="M34 42h52v22a14 14 0 0 1-14 14H48a14 14 0 0 1-14-14z" ${SOFT}/>
    <path d="M34 42h52v22a14 14 0 0 1-14 14H48a14 14 0 0 1-14-14z"/>
    <path d="M86 48h8a8 8 0 0 1 0 16h-8"/>
    <path d="M48 30c-5-7 5-8 0-16M62 30c-5-7 5-8 0-16M76 30c-5-7 5-8 0-16" ${ACCENT_STROKE}/>
    <path d="M50 57l8 8 14-16" ${ACCENT_STROKE}/>
  `),
  // 回收站：一只掀盖的空纸篓，传达"这里暂时是空的"。
  bin: () => svg(`
    <path d="M40 44h40l-4 40a4 4 0 0 1-4 4H48a4 4 0 0 1-4-4z" ${SOFT}/>
    <path d="M40 44h40l-4 40a4 4 0 0 1-4 4H48a4 4 0 0 1-4-4z"/>
    <path d="M34 38h52"/>
    <path d="M60 38l6-18a10 6 0 0 1 12 0" ${ACCENT_STROKE}/>
    <path d="M54 54v22M66 54v22"/>
  `),
  // 资料：夹着书签的文件夹，指向"先保存上下文"。
  folder: () => svg(`
    <path d="M24 34h30l8 10h34v38a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" ${SOFT}/>
    <path d="M24 34h30l8 10h34v38a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z"/>
    <path d="M74 44h14v24l-7-6-7 6z" ${ACCENT_STROKE}/>
  `),
};

/* 未登记的名称返回空串：调用方据此省略插画，不抛错也不留空盒子。 */
export function emptyStateArt(name) {
  const motif = motifs[name];
  return motif === undefined ? '' : motif();
}
