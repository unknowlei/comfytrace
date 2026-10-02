import { parseWorkflow } from '../core/parse';
import type { NodeInventory, Workflow } from '../core/types';
import { extractPngMetadata, isPng, MAX_PNG_BYTES } from './png';

export const MAX_JSON_BYTES = 8 * 1024 * 1024;

function decodeJson(text: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('JSON 格式无效。请从 ComfyUI 重新导出完整工作流，不要粘贴 Markdown 代码围栏。'); }
}

export async function readWorkflowBytes(bytes: Uint8Array, name = 'workflow.json'): Promise<Workflow> {
  if (bytes.length > MAX_PNG_BYTES) throw new Error('文件超过 50 MiB 限制。');
  if (isPng(bytes)) {
    const metadata = await extractPngMetadata(bytes);
    const key = metadata.workflow ? 'workflow' : 'prompt';
    const workflow = parseWorkflow(decodeJson(metadata[key]), name);
    workflow.provenance = `从 PNG 的 ${key} 元数据读取；未执行工作流，也未解码图像像素。`;
    return workflow;
  }
  if (name.toLowerCase().endsWith('.png')) throw new Error('文件扩展名是 PNG，但文件头无效。');
  if (bytes.length > MAX_JSON_BYTES) throw new Error('JSON 文件超过 8 MiB 限制。');
  return parseWorkflow(decodeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), name);
}

export async function readWorkflowFile(file: File): Promise<Workflow> {
  if (file.size > MAX_PNG_BYTES) throw new Error('文件超过 50 MiB 限制。');
  return readWorkflowBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

export function parseInventory(text: string): NodeInventory {
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new Error('节点清单超过 8 MiB 限制。');
  const raw = decodeJson(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('需要 ComfyUI /object_info 返回的 JSON 对象。');
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > 20000) throw new Error('节点清单为空或超过 20,000 项。');
  const inventory: NodeInventory = Object.create(null);
  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Object.hasOwn(entry, 'input')) {
      throw new Error('这不是有效的 /object_info 节点清单，每个节点需要 input 定义。');
    }
    const input = (entry as { input: unknown }).input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('节点清单的 input 必须是对象。');
    for (const group of ['required', 'optional'] as const) {
      if (!Object.hasOwn(input, group)) continue;
      const fields = (input as Record<string, unknown>)[group];
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`节点清单的 ${group} 必须是对象。`);
      for (const spec of Object.values(fields)) {
        if (!Array.isArray(spec) || spec.length === 0 || (typeof spec[0] !== 'string' && !Array.isArray(spec[0]))) {
          throw new Error('节点清单的输入类型描述无效。');
        }
      }
    }
    inventory[key] = entry;
  }
  return inventory;
}

export async function readInventoryFile(file: File): Promise<NodeInventory> {
  if (file.size > MAX_JSON_BYTES) throw new Error('节点清单超过 8 MiB 限制。');
  return parseInventory(await file.text());
}
