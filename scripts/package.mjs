import { deflateRawSync } from 'node:zlib';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(repoRoot, 'manifest.json');
const sourceDirectory = path.join(repoRoot, 'src');
const distDirectory = path.join(repoRoot, 'dist');

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function collectFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function createLocalHeader(name, method, checksum, compressedSize, uncompressedSize) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30 + nameBuffer.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuffer.copy(header, 30);
  return header;
}

function createCentralHeader(name, method, checksum, compressedSize, uncompressedSize, localOffset) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(46 + nameBuffer.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  nameBuffer.copy(header, 46);
  return header;
}

function createEndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('manifest.json must contain a three-part semantic version.');
  }

  const files = ['manifest.json', ...await collectFiles('src')];
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const data = await readFile(path.join(repoRoot, file.split('/').join(path.sep)));
    const compressed = deflateRawSync(data, { level: 9 });
    const method = compressed.length < data.length ? 8 : 0;
    const payload = method === 8 ? compressed : data;
    const checksum = crc32(data);
    const localHeader = createLocalHeader(file, method, checksum, payload.length, data.length);
    const centralHeader = createCentralHeader(file, method, checksum, payload.length, data.length, localOffset);
    localParts.push(localHeader, payload);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const archive = Buffer.concat([
    ...localParts,
    centralDirectory,
    createEndOfCentralDirectory(files.length, centralDirectory.length, localOffset),
  ]);

  await mkdir(distDirectory, { recursive: true });
  const archivePath = path.join(distDirectory, `WorkTodo-v${manifest.version}.zip`);
  try {
    await unlink(archivePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(archivePath, archive);
  console.log(`Created extension package: ${archivePath} (${archive.length.toLocaleString('en-US')} bytes)`);
}

await main();
