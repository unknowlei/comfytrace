import { deflateSync } from 'node:zlib';
import { crc32 } from '../../src/io/png';

export const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const encoder = new TextEncoder();

export function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function chunk(type: string, data: Uint8Array = new Uint8Array()): Uint8Array {
  if (type.length !== 4) throw new Error('PNG chunk type must have four characters.');
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(bytes(type), 4);
  result.set(data, 8);
  view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)));
  return result;
}

export function metadata(
  type: 'tEXt' | 'zTXt' | 'iTXt' | 'comf',
  key: string,
  text: string,
  compressed = false,
): Uint8Array {
  const prefix = concat(bytes(key), Uint8Array.of(0));
  const body = bytes(text);
  if (type === 'zTXt') return chunk(type, concat(prefix, Uint8Array.of(0), deflateSync(body)));
  if (type === 'iTXt') {
    return chunk(type, concat(prefix, Uint8Array.of(compressed ? 1 : 0, 0), bytes('en'),
      Uint8Array.of(0), bytes('Workflow information'), Uint8Array.of(0), compressed ? deflateSync(body) : body));
  }
  return chunk(type, concat(prefix, body));
}

export function png(...metadataChunks: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  header[8] = 8;
  header[9] = 6;
  const pixels = deflateSync(Uint8Array.of(0, 0, 0, 0, 255));
  return concat(signature, chunk('IHDR', header), ...metadataChunks, chunk('IDAT', pixels), chunk('IEND'));
}
