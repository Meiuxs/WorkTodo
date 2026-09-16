# WorkTodo

WorkTodo 是一个无需构建的 Manifest V3 浏览器扩展。扩展运行时不依赖 Node、npm 或网络资源。

开发期需要 Node.js 20+ 仅用于运行单元测试；目标用户不需要安装 Node.js。

## 本地测试

运行 `npm test`（等价于 `node --test`）。完整测试命令将在 Task 9 加入。

## 加载已解压扩展

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库根目录。
4. 点击扩展图标打开 Popup；通过扩展入口打开 Dashboard，并确认开发者工具没有 CSP 或模块错误。
