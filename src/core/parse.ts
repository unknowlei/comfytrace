import type { JsonValue, Workflow, WorkflowLink, WorkflowNode } from './types';

const MAX_NODES = 2_000;
const MAX_LINKS = 10_000;
const MAX_DEPTH = 64;
const MAX_VALUES = 250_000;
const MAX_TEXT = 16 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
type RecordValue = Record<string, JsonValue>;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`工作流解析失败：${message}`);
}

// Validate iteratively before reading fields, including JSON supplied by callers
// rather than JSON.parse. Accessors, cycles, and exotic prototypes are not JSON.
function assertJson(value: unknown): asserts value is JsonValue {
  const pending: Array<{ value: unknown; depth: number; exiting?: boolean }> = [{ value, depth: 0 }];
  const active = new WeakSet<object>();
  let values = 0;
  let textLength = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.exiting) {
      active.delete(current.value as object);
      continue;
    }
    if (++values > MAX_VALUES) fail('数据项过多，最多支持 250000 个 JSON 值。');
    if (current.depth > MAX_DEPTH) fail('嵌套深度超过 64 层。');
    const item = current.value;
    if (item === null || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('JSON 数值必须是有限数。');
      continue;
    }
    if (typeof item === 'string') {
      textLength += item.length;
      if (textLength > MAX_TEXT) fail('文本总量超过 16 MiB 字符限制。');
      continue;
    }
    if (typeof item !== 'object') fail('数据包含非 JSON 类型。');
    if (active.has(item)) fail('数据包含循环引用。');
    active.add(item);
    pending.push({ value: item, depth: current.depth, exiting: true });
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      fail('仅支持普通 JSON 对象和数组。');
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length + values + pending.length > MAX_VALUES + 1) fail('数据项过多。');
    for (const key of keys) {
      if (typeof key !== 'string') fail('JSON 不支持 Symbol 属性。');
      if (Array.isArray(item) && key === 'length') continue;
      if (FORBIDDEN_KEYS.has(key)) fail(`包含不安全的属性名 ${key}。`);
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) fail('JSON 不支持访问器或隐藏属性。');
      if (Array.isArray(item) && !/^(0|[1-9]\d*)$/.test(key)) fail('数组包含非索引属性。');
      textLength += key.length;
      if (textLength > MAX_TEXT) fail('文本总量超过 16 MiB 字符限制。');
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
    if (Array.isArray(item) && keys.length !== item.length + 1) fail('JSON 不支持稀疏数组。');
  }
}

function id(value: JsonValue | undefined, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && value.trim() && value.length <= 128 && !FORBIDDEN_KEYS.has(value)) return value;
  return fail(`${label} 必须是非负安全整数或长度不超过 128 的非空字符串。`);
}

function slot(value: JsonValue | undefined, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return fail(`${label} 必须是非负整数。`);
}

function uiSlot(value: JsonValue | undefined, label: string): number {
  return slot(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value, label);
}

function text(value: JsonValue | undefined, label: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  return fail(`${label} 必须是非空字符串。`);
}

function own(source: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function parseUi(root: RecordValue, raw: JsonValue, name: string): Workflow {
  if (!Array.isArray(root.nodes)) fail('UI 工作流的 nodes 必须是数组。');
  if (root.subgraphs !== undefined && !Array.isArray(root.subgraphs)) fail('UI 工作流的 subgraphs 必须是实例数组。');
  const subgraphInstances = (root.subgraphs ?? []) as JsonValue[];
  const nodeItems = [...root.nodes, ...subgraphInstances];
  if (nodeItems.length > MAX_NODES) fail(`最多支持 ${MAX_NODES} 个节点（含外层子图实例）。`);
  if (root.links !== undefined && !Array.isArray(root.links)) fail('UI 工作流的 links 必须是数组。');
  const rawLinks = (root.links ?? []) as JsonValue[];
  if (rawLinks.length > MAX_LINKS) fail(`最多支持 ${MAX_LINKS} 条连接。`);
  const notices: string[] = [];
  const rawNodes = new Map<string, RecordValue>();
  const nodes: WorkflowNode[] = [];
  const links: WorkflowLink[] = [];
  const seenLinkIds = new Set<string>();
  const version = typeof root.version === 'number' || typeof root.version === 'string' ? String(root.version) : 'unknown';
  if (version === 'unknown') notices.push('工作流未声明版本；按 UI 节点与连接结构读取。');
  else if (version !== '0.4' && version !== '1' && version !== '1.0') notices.push(`工作流版本 ${version} 未经支持确认；仅解析已知字段。`);
  if (nodeItems.length === 0) notices.push('工作流不包含任何节点。');
  if (record(root.definitions) && Array.isArray(root.definitions.subgraphs) && root.definitions.subgraphs.length) {
    notices.push('此工作流包含子图 definitions.subgraphs；仅分析外层图，未展开子图内部、端口代理或内部依赖。');
  }
  if (Array.isArray(root.subgraphs) && root.subgraphs.length) notices.push('此工作流包含顶层 subgraphs；仅分析外层图，未展开子图内部、端口代理或内部依赖。');
  if (Array.isArray(root.floatingLinks) && root.floatingLinks.length) notices.push('此工作流包含 floatingLinks；悬浮连接未纳入执行图分析。');

  for (const item of nodeItems) {
    if (!record(item)) fail('每个 UI 节点必须是对象。');
    const nodeId = id(item.id, '节点 ID');
    if (rawNodes.has(nodeId)) fail(`节点 ID ${nodeId} 重复。`);
    rawNodes.set(nodeId, item);
    const nodeType = text(item.type, `节点 ${nodeId} 的 type`);
    let mode = 0;
    if (item.mode !== undefined) {
      if (typeof item.mode !== 'number' || !Number.isSafeInteger(item.mode) || item.mode < 0) fail(`节点 ${nodeId} 的 mode 必须是非负整数。`);
      mode = item.mode;
    }
    const inputs: Record<string, JsonValue> = Object.create(null);
    if (item.inputs !== undefined && !Array.isArray(item.inputs)) fail(`节点 ${nodeId} 的 inputs 必须是数组。`);
    if (item.outputs !== undefined && !Array.isArray(item.outputs)) fail(`节点 ${nodeId} 的 outputs 必须是数组。`);
    const inputSlots = (item.inputs ?? []) as JsonValue[];
    for (const [index, input] of inputSlots.entries()) {
      if (!record(input)) fail(`节点 ${nodeId} 的输入槽 ${index} 必须是对象。`);
      const inputName = typeof input.name === 'string' && input.name ? input.name : `input_${index}`;
      if (FORBIDDEN_KEYS.has(inputName)) fail(`节点 ${nodeId} 含不安全的输入名称。`);
      if (Object.prototype.hasOwnProperty.call(inputs, inputName)) fail(`节点 ${nodeId} 的输入名称 ${inputName} 重复。`);
      const inputLink = input.link === null || input.link === undefined ? null : id(input.link, `节点 ${nodeId} 的输入连接 ID`);
      inputs[inputName] = { slot: index, type: input.type ?? null, link: inputLink };
      if (input.name === undefined) notices.push(`节点 ${nodeId} 的输入槽 ${index} 缺少 name，采用位置名称。`);
    }
    if (item.properties !== undefined && !record(item.properties)) fail(`节点 ${nodeId} 的 properties 必须是对象。`);
    const props = record(item.properties) ? item.properties : undefined;
    const packageName = props && (typeof props.cnr_id === 'string' ? props.cnr_id : typeof props.aux_id === 'string' ? props.aux_id : undefined);
    const node: WorkflowNode = {
      id: nodeId,
      type: nodeType,
      title: typeof item.title === 'string' && item.title ? item.title : nodeType,
      mode,
      inputs,
      widgets: item.widgets_values ?? [],
      properties: props ?? {},
      ...(packageName ? { packageName } : {}),
    };
    if (Array.isArray(item.pos) && typeof item.pos[0] === 'number' && typeof item.pos[1] === 'number') {
      node.position = [item.pos[0], item.pos[1]];
    } else if (record(item.pos) && typeof item.pos['0'] === 'number' && typeof item.pos['1'] === 'number') {
      node.position = [item.pos['0'], item.pos['1']];
    }
    if (item.widgets_values !== undefined && !Array.isArray(item.widgets_values) && !record(item.widgets_values)) {
      notices.push(`节点 ${nodeId} 的 widgets_values 不是数组或对象；保留原值，无法识别位置参数。`);
    }
    nodes.push(node);
  }

  for (const item of rawLinks) {
    let link: WorkflowLink;
    if (Array.isArray(item)) {
      if (item.length < 6) fail('UI 元组连接至少需要 6 个字段。');
      link = {
        id: id(item[0], '连接 ID'), source: id(item[1], '连接起点'), sourceSlot: uiSlot(item[2], '输出槽'),
        target: id(item[3], '连接终点'), targetSlot: uiSlot(item[4], '输入槽'),
        type: item[5],
      };
    } else if (record(item)) {
      link = {
        id: id(item.id, '连接 ID'), source: id(item.origin_id, '连接起点'), sourceSlot: uiSlot(item.origin_slot, '输出槽'),
        target: id(item.target_id, '连接终点'), targetSlot: uiSlot(item.target_slot, '输入槽'),
        ...(item.type !== undefined ? { type: item.type } : {}),
      };
    } else fail('连接必须是 UI 0.4 元组或 UI 1.0 对象。');
    if (link.type === undefined) notices.push(`连接 ${link.id} 未声明 type；无法检查端口类型信息。`);
    else if (typeof link.type !== 'string' && typeof link.type !== 'number' && !(Array.isArray(link.type) && link.type.every((type) => typeof type === 'string'))) {
      notices.push(`连接 ${link.id} 的 type 不是已知的字符串、字符串数组或数值；保留原值供检查。`);
    }
    if (seenLinkIds.has(link.id)) fail(`连接 ID ${link.id} 重复。`);
    seenLinkIds.add(link.id);
    links.push(link);
  }

  const byLinkId = new Map(links.map((link) => [link.id, link]));
  for (const [nodeId, node] of rawNodes) {
    if (Array.isArray(node.inputs)) {
      for (const [index, input] of node.inputs.entries()) {
        if (!record(input) || input.link === null || input.link === undefined) continue;
        const reference = id(input.link, '输入连接 ID');
        const link = byLinkId.get(reference);
        if (!link) notices.push(`节点 ${nodeId} 输入槽 ${index} 引用了不存在的连接 ${reference}。`);
        else if (link.target !== nodeId || link.targetSlot !== index) notices.push(`节点 ${nodeId} 输入槽 ${index} 的连接 ${reference} 指向其他输入槽。`);
      }
    }
    if (Array.isArray(node.outputs)) {
      for (const [index, output] of node.outputs.entries()) {
        if (!record(output)) fail(`节点 ${nodeId} 的输出槽 ${index} 必须是对象。`);
        if (output.links === null || output.links === undefined) continue;
        if (!Array.isArray(output.links)) fail(`节点 ${nodeId} 的输出槽 links 必须是数组或 null。`);
        const seen = new Set<string>();
        for (const reference of output.links) {
          const referenceId = id(reference, '输出连接 ID');
          if (seen.has(referenceId)) notices.push(`节点 ${nodeId} 输出槽 ${index} 重复声明连接 ${referenceId}。`);
          seen.add(referenceId);
          const link = byLinkId.get(referenceId);
          if (!link) notices.push(`节点 ${nodeId} 输出槽 ${index} 引用了不存在的连接 ${referenceId}。`);
          else if (link.source !== nodeId || link.sourceSlot !== index) notices.push(`节点 ${nodeId} 输出槽 ${index} 的连接 ${referenceId} 属于其他输出槽。`);
        }
      }
    }
  }
  for (const link of links) {
    const source = rawNodes.get(link.source);
    const target = rawNodes.get(link.target);
    if (source) {
      if (!Array.isArray(source.outputs)) notices.push(`连接 ${link.id} 的起点节点 ${link.source} 未声明 outputs，无法验证输出槽。`);
      else if (link.sourceSlot >= source.outputs.length) notices.push(`连接 ${link.id} 的输出槽 ${link.sourceSlot} 超出节点 ${link.source} 声明范围。`);
      else {
        const output = source.outputs[link.sourceSlot];
        if (record(output) && (!Array.isArray(output.links) || !output.links.some((reference) => String(reference) === link.id))) {
          notices.push(`连接 ${link.id} 未在节点 ${link.source} 输出槽 ${link.sourceSlot} 的 links 中声明。`);
        }
      }
    }
    if (target) {
      if (!Array.isArray(target.inputs)) notices.push(`连接 ${link.id} 的终点节点 ${link.target} 未声明 inputs，无法验证输入槽。`);
      else if ((link.targetSlot as number) >= target.inputs.length) notices.push(`连接 ${link.id} 的输入槽 ${link.targetSlot} 超出节点 ${link.target} 声明范围。`);
      else {
        const input = target.inputs[link.targetSlot as number];
        if (record(input) && String(input.link) !== link.id) notices.push(`连接 ${link.id} 与节点 ${link.target} 输入槽 ${link.targetSlot} 的 link 声明不一致。`);
      }
    }
  }
  return { name, format: 'ui', version, nodes, links, raw, notices };
}

function parseApi(root: RecordValue, raw: JsonValue, name: string): Workflow {
  const entries = Object.entries(root);
  if (!entries.length) fail('API prompt 不包含节点。');
  if (entries.length > MAX_NODES) fail(`最多支持 ${MAX_NODES} 个节点。`);
  const nodes: WorkflowNode[] = [];
  const links: WorkflowLink[] = [];
  const notices: string[] = [];
  for (const [rawId, item] of entries) {
    const nodeId = id(rawId, 'API 节点 ID');
    if (!record(item)) fail(`API 节点 ${nodeId} 必须是对象。`);
    const nodeType = text(item.class_type, `API 节点 ${nodeId} 的 class_type`);
    if (!record(item.inputs)) fail(`API 节点 ${nodeId} 的 inputs 必须是对象。`);
    const inputs: Record<string, JsonValue> = Object.create(null);
    for (const [inputName, value] of Object.entries(item.inputs)) {
      inputs[inputName] = value;
      // ComfyUI's is_link requires [string, number]. Numeric pairs are values.
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
        links.push({ id: JSON.stringify([nodeId, inputName]), source: id(value[0], 'API 连接起点'), sourceSlot: slot(value[1], 'API 输出槽'), target: nodeId, targetSlot: inputName });
        if (links.length > MAX_LINKS) fail(`最多支持 ${MAX_LINKS} 条连接。`);
      }
    }
    const meta = record(item._meta) ? item._meta : undefined;
    nodes.push({ id: nodeId, type: nodeType, title: meta && typeof meta.title === 'string' && meta.title ? meta.title : nodeType, mode: 0, inputs, widgets: [] });
  }
  return { name, format: 'api', version: 'api', nodes, links, raw, notices };
}

/** Normalize an already-decoded JSON value without mutating the source. */
export function parseWorkflow(input: unknown, name = 'Untitled workflow'): Workflow {
  assertJson(input);
  if (!record(input)) fail('根数据必须是 JSON 对象。');
  if (Array.isArray(input.nodes) || (own(input, 'nodes') && (own(input, 'version') || own(input, 'links')))) return parseUi(input, input, name);
  if (own(input, 'prompt') && record(input.prompt) && !own(input.prompt, 'class_type')) return parseApi(input.prompt, input, name);
  return parseApi(input, input, name);
}
