import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function toPath(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

export async function collectJavaScriptFiles(root) {
  const directory = toPath(root);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

export function checkSyntax(files, run = spawnSync) {
  const failures = [];
  for (const file of files) {
    const result = run(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failures.push(file);
  }
  return failures;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  const sourceRoot = path.resolve(path.dirname(scriptPath), '..', 'src');
  const files = await collectJavaScriptFiles(sourceRoot);
  const failures = checkSyntax(files);
  if (failures.length > 0) {
    console.error(`语法检查失败：${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`语法检查通过：${files.length} 个 JavaScript 文件`);
  }
}
