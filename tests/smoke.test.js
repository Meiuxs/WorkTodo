import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('manifest 只声明 V1.0 所需的 storage 权限', async () => {
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions ?? [], []);
  assert.equal(manifest.background.type, 'module');
});

/* 这条约束只能读源码守：扩展弹窗的窗口尺寸由文档宽度倒推，vw 又按弹窗视口解析，
   两者互相依赖时 Chromium 退到最小内容宽度，弹窗塌成一条竖条。
   用普通标签页打开 popup.html 时 100vw 等于标签页宽度，E2E 永远测不出这个塌陷。 */
test('Popup 宽度是固定像素，不使用视口单位', async () => {
  const css = await readFile('src/popup/popup.css', 'utf8');
  assert.match(css, /body\s*\{[^}]*width:\s*\d+px/);
  assert.doesNotMatch(css, /\d+vw/);
});
