/* 侧栏数量角标：把"还有多少要处理"提前放到导航上，不必先点进去才知道。
   角标只复用页面上已有的数字（今天页的逾期数、收集箱页的总数），不新增状态语义。
   可访问性处理：
   - 角标本身标 aria-hidden，不参与按钮的可访问名称，导航项名称保持稳定；
   - 数字通过 aria-describedby 交给读屏，读屏用户同样能听到。 */

const BADGE_RULES = Object.freeze([
  Object.freeze({
    name: 'today',
    load: ({ query, date }) => query.overdue(date),
    describe: (count) => `${count} 项逾期待处理`,
  }),
  Object.freeze({
    name: 'inbox',
    load: ({ query }) => query.inbox(),
    describe: (count) => `${count} 项待整理`,
  }),
]);

export function createNavBadges({ container, query, today }) {
  function render(rule, count) {
    const badge = container.querySelector(`[data-nav-badge="${rule.name}"]`);
    if (badge === null) return;
    badge.textContent = count > 0 ? String(count) : '';
    badge.hidden = count === 0;
    const description = container.querySelector(`[data-nav-badge-desc="${rule.name}"]`);
    if (description !== null) {
      description.textContent = count > 0 ? rule.describe(count) : '';
    }
  }

  return {
    async refresh() {
      const date = today();
      const results = await Promise.all(BADGE_RULES.map((rule) => rule.load({ query, date })));
      BADGE_RULES.forEach((rule, index) => render(rule, results[index].length));
    },
  };
}
