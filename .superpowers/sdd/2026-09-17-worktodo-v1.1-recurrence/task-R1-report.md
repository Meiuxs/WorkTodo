# Task R1 实现报告

## 改动摘要

- 在 `src/domain/dates.js` 增加 `addLocalMonthsClamped`，处理跨年、闰年及目标月份天数不足时的月末钳制。
- 新增 `src/domain/recurring-template.js`，提供重复模板创建与校验、每天/工作日/每周/月/年/自定义规则的下一次日期计算，以及 occurrenceKey 生成。
- 新增重复模板领域测试，并补充日期月末钳制测试。

## 测试命令与完整结果

- `node --test tests/domain/dates.test.js tests/domain/recurring-template.test.js`：6 个测试通过，0 个失败。
- `npm run test:unit`：167 个测试通过，0 个失败。

边界审查补充：新增年重复、跨周工作日、自定义日/周/月，以及间隔 0/91/非整数和非法自定义单位测试；当前实现已覆盖，`node --test tests/domain/recurring-template.test.js` 为 3/3 通过。

## 已知疑问

- R1 只覆盖领域模型和日期规则；模板持久化、实例生成、编辑器与系列生命周期由后续 R2-R6 任务实现。
- 工作日判断按日期的 UTC 表示计算星期几，以避免运行环境时区影响日期字符串规则。
