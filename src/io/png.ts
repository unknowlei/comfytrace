const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const MAX_PNG_BYTES = 50 * 1024 * 1024;
export const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_CHUNKS = 100000;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function ascii(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

function text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return ascii(bytes); }
}

async function inflateBounded(bytes: Uint8Array, budget: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持压缩 PNG 元数据，请使用新版 Chrome、Edge 或 Firefox，或导出 JSON。');
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > budget) {
        await reader.cancel();
        throw new Error('PNG 解压后的元数据超过 8 MiB 限制。');
      }
      parts.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof Error && error.message.includes('8 MiB') ? error : new Error('PNG 压缩元数据损坏，无法解压。');
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

export async function extractPngMetadata(bytes: Uint8Array): Promise<Record<string, string>> {
  if (bytes.length > MAX_PNG_BYTES) throw new Error('PNG 文件超过 50 MiB 限制。');
  if (!isPng(bytes)) throw new Error('文件不是有效的 PNG。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Record<string, string> = Object.create(null);
  let offset = 8;
  let count = 0;
  let total = 0;
  let ended = false;
  while (offset < bytes.length) {
    if (++count > MAX_CHUNKS) throw new Error('PNG 数据块数量超出安全限制。');
    if (offset + 12 > bytes.length) throw new Error('PNG 数据块被截断。');
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('PNG 数据块长度超出文件边界。');
    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (count === 1 && (type !== 'IHDR' || length !== 13)) throw new Error('PNG 缺少有效的 IHDR 文件头。');
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) throw new Error(`PNG ${type} 数据块校验失败，文件可能已损坏。`);
    if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG IEND 数据块无效。');
      ended = true;
      break;
    }
    if (['tEXt', 'zTXt', 'iTXt', 'comf'].includes(type)) {
      if (length > MAX_METADATA_BYTES) throw new Error('PNG 元数据超过 8 MiB 限制。');
      const separator = data.indexOf(0);
      if (separator < 1 || separator > 79) throw new Error('PNG 文本元数据缺少有效键名。');
      const key = ascii(data.subarray(0, separator));
      if (key === 'workflow' || key === 'prompt') {
        let payload = data.subarray(separator + 1);
        if (type === 'zTXt') {
          if (payload[0] !== 0) throw new Error('PNG zTXt 使用不支持的压缩方法。');
          payload = await inflateBounded(payload.subarray(1), MAX_METADATA_BYTES - total);
        } else if (type === 'iTXt') {
          if (payload.length < 4 || payload[0] > 1 || payload[1] !== 0) throw new Error('PNG iTXt 格式无效。');
          const compressed = payload[0] === 1;
          const languageEnd = payload.indexOf(0, 2);
          const translatedEnd = languageEnd < 0 ? -1 : payload.indexOf(0, languageEnd + 1);
          if (translatedEnd < 0) throw new Error('PNG iTXt 字段被截断。');
          payload = payload.subarray(translatedEnd + 1);
          if (compressed) payload = await inflateBounded(payload, MAX_METADATA_BYTES - total);
        }
        total += payload.length;
        if (total > MAX_METADATA_BYTES) throw new Error('PNG 元数据总量超过 8 MiB 限制。');
        if (Object.hasOwn(result, key)) throw new Error(`PNG 包含重复的 ${key} 元数据，请重新导出。`);
        result[key] = text(payload);
      }
    }
    offset = end;
  }
  if (!ended) throw new Error('PNG 缺少 IEND 结束数据块。');
  if (!result.workflow && !result.prompt) throw new Error('图片中没有 ComfyUI 工作流信息。请使用原始 PNG，或从 ComfyUI 导出 JSON。');
  return result;
}
