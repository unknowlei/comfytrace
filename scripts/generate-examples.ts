import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { demoWorkflow, demoRevision, brokenWorkflow, demoApi, demoInventory } from '../src/data/demo';
import { crc32 } from '../src/io/png';

const root = new URL('../examples/', import.meta.url);
await mkdir(root, { recursive: true });
for (const [name, value] of Object.entries({ 'platform-workflow': demoWorkflow, 'platform-revision': demoRevision, 'broken-workflow': brokenWorkflow, 'api-prompt': demoApi, 'object-info': demoInventory })) {
  await writeFile(new URL(`${name}.json`, root), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function chunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, 'ascii');
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}

// A 2x2 blue swatch, not an AI-generated output; it is a reproducible metadata fixture.
const header = Buffer.alloc(13);
header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
const pixels = Buffer.from([0, 49, 93, 221, 120, 165, 245, 0, 190, 214, 255, 243, 246, 250]);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('iTXt', Buffer.concat([Buffer.from('workflow\0\x01\x00\x00\x00'), deflateSync(Buffer.from(JSON.stringify(demoWorkflow), 'utf8'))])),
  chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
]);
await writeFile(new URL('workflow-metadata.png', root), png);
process.stdout.write(`Generated original examples in ${fileURLToPath(root)}\n`);
