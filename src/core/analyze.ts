import type { Analysis, Dependency, Diagnostic, JsonValue, NodeInventory, Workflow, WorkflowNode } from './types';

const OUTPUT_TYPES = new Set(['SaveImage', 'PreviewImage', 'SaveAnimatedWEBP', 'SaveAnimatedPNG', 'SaveAudio', 'PreviewAudio', 'SaveLatent']);
const UI_ONLY_TYPES = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode']);
const LOADER_FIELDS: Record<string, string[]> = {
  CheckpointLoaderSimple: ['ckpt_name'], CheckpointLoader: ['ckpt_name'], unCLIPCheckpointLoader: ['ckpt_name'],
  LoraLoader: ['lora_name'], LoraLoaderModelOnly: ['lora_name'], VAELoader: ['vae_name'],
  CLIPLoader: ['clip_name'], DualCLIPLoader: ['clip_name1', 'clip_name2'], TripleCLIPLoader: ['clip_name1', 'clip_name2', 'clip_name3'],
  CLIPVisionLoader: ['clip_name'], UNETLoader: ['unet_name'], ControlNetLoader: ['control_net_name'], DiffControlNetLoader: ['control_net_name'],
  UpscaleModelLoader: ['model_name'], StyleModelLoader: ['style_model_name'], GLIGENLoader: ['gligen_name'],
  HypernetworkLoader: ['hypernetwork_name'], PhotoMakerLoader: ['photomaker_model_name'],
};

function record(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function rawUiNodes(workflow: Workflow): Map<string, Record<string, JsonValue>> {
  if (workflow.format !== 'ui' || !record(workflow.raw) || !Array.isArray(workflow.raw.nodes)) return new Map();
  const instances = Array.isArray(workflow.raw.subgraphs) ? workflow.raw.subgraphs : [];
  return new Map([...workflow.raw.nodes, ...instances].filter(record).map((node) => [String(node.id), node]));
}

function subgraphTypes(workflow: Workflow): Set<string> {
  if (!record(workflow.raw)) return new Set();
  const nested = record(workflow.raw.definitions) && Array.isArray(workflow.raw.definitions.subgraphs) ? workflow.raw.definitions.subgraphs : [];
  const topLevel = Array.isArray(workflow.raw.subgraphs) ? workflow.raw.subgraphs : [];
  return new Set([
    ...nested.filter(record).filter((graph) => typeof graph.id === 'string').map((graph) => String(graph.id)),
    ...topLevel.filter(record).filter((graph) => typeof graph.type === 'string').map((graph) => String(graph.type)),
  ]);
}

// Iterative Kosaraju avoids call-stack limits and does not mislabel nodes
// downstream of a cycle as members of the cycle itself.
function findCycles(adjacency: Map<string, Set<string>>, reverse: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>();
  const finish: string[] = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack: Array<{ id: string; neighbors: string[]; index: number }> = [{ id: start, neighbors: [...adjacency.get(start)!], index: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.neighbors.length) {
        finish.push(frame.id);
        stack.pop();
        continue;
      }
      const next = frame.neighbors[frame.index++];
      if (!seen.has(next)) {
        seen.add(next);
        stack.push({ id: next, neighbors: [...adjacency.get(next)!], index: 0 });
      }
    }
  }
  const assigned = new Set<string>();
  const cycles: string[][] = [];
  for (const start of finish.reverse()) {
    if (assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const previous of reverse.get(current)!) {
        if (!assigned.has(previous)) {
          assigned.add(previous);
          stack.push(previous);
        }
      }
    }
    if (component.length > 1 || adjacency.get(component[0])!.has(component[0])) cycles.push(component.sort());
  }
  return cycles;
}

function inventoryEntry(inventory: NodeInventory | undefined, type: string): Record<string, JsonValue> | undefined {
  const entry = inventory && Object.getOwnPropertyDescriptor(inventory, type)?.value;
  if (record(entry)) return entry;
  return undefined;
}

function declaredOutput(inventory: NodeInventory | undefined, type: string): boolean {
  const entry = inventoryEntry(inventory, type);
  return entry !== undefined && Object.getOwnPropertyDescriptor(entry, 'output_node')?.value === true;
}

function modelValues(node: WorkflowNode, workflow: Workflow): Array<{ name: string; source: string }> {
  if (!own(LOADER_FIELDS, node.type)) return [];
  const fields = LOADER_FIELDS[node.type];
  const found: Array<{ name: string; source: string }> = [];
  for (const [index, field] of fields.entries()) {
    // The legacy loader puts config_name before ckpt_name in widget order.
    const widgetIndex = node.type === 'CheckpointLoader' ? index + 1 : index;
    const value = workflow.format === 'api' ? node.inputs[field] : Array.isArray(node.widgets) ? node.widgets[widgetIndex] : record(node.widgets) ? node.widgets[field] : undefined;
    if (typeof value !== 'string' || !value.trim() || /^(none|\(none\))$/i.test(value)) continue;
    const source = workflow.format === 'api' ? `${node.type}.inputs.${field}` : Array.isArray(node.widgets) ? `${node.type}.widgets_values[${widgetIndex}] (${field})` : `${node.type}.widgets_values.${field}`;
    found.push({ name: value, source });
  }
  return found;
}

/** Static graph evidence only: runtime execution and model availability are not inferred. */
export function analyzeWorkflow(workflow: Workflow, inventory?: NodeInventory): Analysis {
  const diagnostics: Diagnostic[] = [];
  const dependencyMap = new Map<string, Dependency>();
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const adjacency = new Map(workflow.nodes.map((node) => [node.id, new Set<string>()]));
  const reverse = new Map(workflow.nodes.map((node) => [node.id, new Set<string>()]));
  const occupied = new Map<string, string>();
  const embedded = subgraphTypes(workflow);
  const rawNodes = rawUiNodes(workflow);
  const add = (code: string, severity: Diagnostic['severity'], title: string, message: string, nodeIds: string[] = []) => diagnostics.push({ code, severity, title, message, nodeIds });
  const dependency = (entry: Dependency) => {
    const key = `${entry.kind}\u0000${entry.name}`;
    const existing = dependencyMap.get(key);
    if (!existing) dependencyMap.set(key, entry);
    else for (const nodeId of entry.nodeIds) if (!existing.nodeIds.includes(nodeId)) existing.nodeIds.push(nodeId);
  };

  for (const notice of workflow.notices) add('PARSE_NOTICE', 'warning', '结构与格式提示', notice);
  if (inventory !== undefined && !record(inventory)) throw new Error('节点库存必须是 object_info 返回的对象。');
  for (const link of workflow.links) {
    const sourceExists = nodes.has(link.source);
    const targetExists = nodes.has(link.target);
    if (!sourceExists || !targetExists) {
      add('DANGLING_LINK', 'error', '连接引用不存在的节点', `连接 ${link.id}：${link.source}:${link.sourceSlot} → ${link.target}:${link.targetSlot}；${!sourceExists ? '起点' : ''}${!sourceExists && !targetExists ? '与' : ''}${!targetExists ? '终点' : ''}不存在。`, [link.source, link.target].filter((nodeId) => nodes.has(nodeId)));
    }
    const targetKey = JSON.stringify([link.target, link.targetSlot]);
    const previous = occupied.get(targetKey);
    if (previous !== undefined) add('MULTIPLE_INPUT_LINKS', 'error', '同一输入槽存在多条连接', `节点 ${link.target} 输入槽 ${link.targetSlot} 同时被连接 ${previous} 和 ${link.id} 占用。`, targetExists ? [link.target] : []);
    else occupied.set(targetKey, link.id);
    if (sourceExists && targetExists) {
      adjacency.get(link.source)!.add(link.target);
      reverse.get(link.target)!.add(link.source);
    }
  }

  for (const node of workflow.nodes) {
    if (!embedded.has(node.type) && !(workflow.format === 'ui' && UI_ONLY_TYPES.has(node.type))) {
      const available = inventoryEntry(inventory, node.type);
      const status = inventory === undefined ? 'unknown' : available ? 'available' : own(inventory, node.type) ? 'unknown' : 'missing';
      dependency({ kind: 'node', name: node.type, nodeIds: [node.id], source: node.packageName ? `节点元数据：${node.packageName}` : '工作流节点类型', status });
      if (inventory !== undefined && own(inventory, node.type) && !available) add('INVALID_INVENTORY_ENTRY', 'warning', '节点库存条目格式不完整', `库存中的 ${node.type} 不是 object_info 节点定义，安装状态保持未知。`, [node.id]);
    }
    for (const model of modelValues(node, workflow)) dependency({ kind: 'model', name: model.name, nodeIds: [node.id], source: model.source, status: 'unknown' });
    const raw = rawNodes.get(node.id);
    if (raw && record(raw.properties) && Array.isArray(raw.properties.models)) {
      for (const model of raw.properties.models) {
        if (record(model) && typeof model.name === 'string' && model.name.trim()) dependency({ kind: 'model', name: model.name, nodeIds: [node.id], source: `${node.type}.properties.models (声明元数据)`, status: 'unknown' });
      }
    }
    if (node.mode === 2) add('MUTED_NODE', 'info', '节点已静音', `节点 ${node.id} 的 mode=2；保留可视连接用于结构检查，不推断运行时结果。`, [node.id]);
    else if (node.mode === 4) add('BYPASSED_NODE', 'info', '节点已旁路', `节点 ${node.id} 的 mode=4；本工具不重写旁路端口，显示的是原始连接图。`, [node.id]);
    else if (node.mode !== 0) add('UNKNOWN_NODE_MODE', 'warning', '节点使用特殊执行模式', `节点 ${node.id} 的 mode=${node.mode}；无法在静态检查中确定执行行为。`, [node.id]);
    if (!adjacency.get(node.id)!.size && !reverse.get(node.id)!.size) add('ISOLATED_NODE', 'info', '未连接的节点', `节点 ${node.id} 没有连接；可能是备用节点、独立输出或尚未接线。`, [node.id]);
  }
  const dependencies = [...dependencyMap.values()];
  for (const item of dependencies) if (item.kind === 'node' && item.status === 'missing') add('MISSING_NODE_TYPE', 'warning', '提供的库存中缺少节点类型', `${item.name} 不在此 object_info 库存中；库存可能来自其他实例或不同时间。`, item.nodeIds);

  for (const cycle of findCycles(adjacency, reverse)) {
    add('GRAPH_CYCLE', 'error', '检测到有向环', `节点 ${cycle.join('、')} 构成环，无法对这部分原始连接进行拓扑排序；特殊循环节点与旁路语义需要在 ComfyUI 中确认。`, cycle);
  }
  const indegree = new Map([...reverse].map(([nodeId, previous]) => [nodeId, previous.size]));
  let frontier = workflow.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const layers: string[][] = [];
  while (frontier.length) {
    layers.push(frontier);
    const next: string[] = [];
    for (const nodeId of frontier) for (const target of adjacency.get(nodeId)!) {
      const remaining = indegree.get(target)! - 1;
      indegree.set(target, remaining);
      if (remaining === 0) next.push(target);
    }
    frontier = next;
  }
  const outputNodes = workflow.nodes.filter((node) => node.mode === 0 && (OUTPUT_TYPES.has(node.type) || declaredOutput(inventory, node.type)));
  if (workflow.nodes.length && !outputNodes.length) add('NO_KNOWN_OUTPUT', 'warning', '未识别到启用的输出节点', '常见输出节点与提供的 object_info 中均未识别到启用的输出节点；自定义输出与子图可能无法识别，此提示不代表工作流一定不能执行。');

  return {
    diagnostics, dependencies, layers,
    stats: {
      nodes: workflow.nodes.length, links: workflow.links.length, nodeTypes: new Set(workflow.nodes.map((node) => node.type)).size,
      models: dependencies.filter((item) => item.kind === 'model').length,
      errors: diagnostics.filter((item) => item.severity === 'error').length,
      warnings: diagnostics.filter((item) => item.severity === 'warning').length,
    },
  };
}
