import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
const archivePath = path.join(repoRoot, 'dist', `WorkTodo-v${manifest.version}.zip`);
const archive = await readFile(archivePath);

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP central directory record not found.');
}

function readZipEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry at offset ${offset}.`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, compressedSize, uncompressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (offset - centralOffset !== centralSize) {
    throw new Error('ZIP central directory size does not match its entries.');
  }
  return entries;
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`Invalid manifest version: ${manifest.version}`);
}
if (manifest.manifest_version !== 3) throw new Error('Manifest must use Manifest V3.');
if (JSON.stringify(manifest.permissions ?? []) !== JSON.stringify(['storage'])) {
  throw new Error('Manifest permissions must remain the explicit storage allowlist.');
}
if (manifest.host_permissions?.length) throw new Error('Manifest must not declare host permissions.');
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (csp !== "script-src 'self'; object-src 'self'") {
  throw new Error(`Unexpected extension CSP: ${csp}`);
}

for (const requiredFile of [manifest.action?.default_popup, manifest.background?.service_worker]) {
  if (!requiredFile) throw new Error('Manifest is missing a required entry file.');
  await readFile(path.join(repoRoot, requiredFile.split('/').join(path.sep)));
}

const entries = readZipEntries(archive);
const allowed = entries.every(({ name }) => name === 'manifest.json' || name.startsWith('src/'));
if (!allowed || !entries.some(({ name }) => name === 'manifest.json')) {
  throw new Error(`ZIP contains entries outside the manifest/src allowlist: ${entries.map(({ name }) => name).join(', ')}`);
}
if (entries.some(({ name }) => name.endsWith('/'))) throw new Error('ZIP must not contain directory entries.');
if (entries.some(({ compressedSize, uncompressedSize }) => compressedSize === 0 && uncompressedSize > 0)) {
  throw new Error('ZIP contains an invalid empty compressed entry.');
}

console.log(`Package verified: WorkTodo-v${manifest.version}.zip (${entries.length} allowed files, Manifest V3, CSP and permissions passed)`);
