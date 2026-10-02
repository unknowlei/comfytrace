import type { Difference, DiffResult, JsonValue, Workflow, WorkflowLink, WorkflowNode } from './types';

interface DiffContext {
  workflow: Workflow;
  byLinkId: Map<string, WorkflowLink>;
  incoming: Map<string, WorkflowLink[]>;
}

function context(workflow: Workflow): DiffContext {
  const incoming = new Map<string, WorkflowLink[]>();
  for (const link of workflow.links) {
    const links = incoming.get(link.target);
    if (links) links.push(link);
    else incoming.set(link.target, [link]);
  }
  return { workflow, byLinkId: new Map(workflow.links.map((link) => [link.id, link])), incoming };
}

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function executionInputs(node: WorkflowNode, ctx: DiffContext): JsonValue {
  const { workflow, byLinkId } = ctx;
  const result: Record<string, JsonValue> = Object.create(null);
  const connected = new Set((ctx.incoming.get(node.id) ?? []).map((link) => link.targetSlot));
  for (const [key, value] of Object.entries(node.inputs)) {
    if (workflow.format === 'api') {
      if (!connected.has(key)) result[key] = value;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const { link: declaredLink, ...definition } = value;
      if (typeof declaredLink === 'string') {
        const resolved = byLinkId.get(declaredLink);
        if (!resolved) definition.unresolvedLink = declaredLink;
        else if (resolved.target !== node.id || resolved.targetSlot !== value.slot) {
          definition.mismatchedLink = { source: resolved.source, sourceSlot: resolved.sourceSlot, target: resolved.target, targetSlot: resolved.targetSlot };
        }
      } else if (connected.has(value.slot as number)) definition.declaredLink = null;
      result[key] = definition;
    } else result[key] = value;
  }
  return result;
}

function incomingLinks(node: WorkflowNode, ctx: DiffContext): JsonValue {
  const result = (ctx.incoming.get(node.id) ?? []).map((link) => ({ source: link.source, sourceSlot: link.sourceSlot, targetSlot: link.targetSlot, ...(link.type !== undefined ? { type: link.type } : {}) }));
  return result.sort((left, right) => canonical(left).localeCompare(canonical(right)));
}

function executionNode(node: WorkflowNode, ctx: DiffContext): Record<string, JsonValue> {
  return { type: node.type, mode: node.mode, widgets: node.widgets, inputs: executionInputs(node, ctx), links: incomingLinks(node, ctx), properties: node.properties ?? {} };
}

/** Node IDs define identity. Layout, labels, link IDs, and viewport do not. */
export function diffWorkflows(before: Workflow, after: Workflow): DiffResult {
  if (before.format !== after.format) return {
    changes: [], unchangedNodes: 0, comparable: false,
    notices: ['UI 工作流与 API prompt 的参数编码及节点集合可能不同，无法可靠进行跨格式语义比较；请比较同一格式的两个版本。'],
  };
  const changes: Difference[] = [];
  const previous = new Map(before.nodes.map((node) => [node.id, node]));
  const current = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeContext = context(before);
  const afterContext = context(after);
  let unchangedNodes = 0;
  for (const node of before.nodes) {
    if (!current.has(node.id)) changes.push({ kind: 'removed', nodeId: node.id, subject: node.type, field: 'node', before: executionNode(node, beforeContext) });
  }
  for (const node of after.nodes) {
    const old = previous.get(node.id);
    if (!old) {
      changes.push({ kind: 'added', nodeId: node.id, subject: node.type, field: 'node', after: executionNode(node, afterContext) });
      continue;
    }
    const oldExecution = executionNode(old, beforeContext);
    const newExecution = executionNode(node, afterContext);
    let changed = false;
    for (const field of Object.keys(oldExecution)) {
      if (canonical(oldExecution[field]) !== canonical(newExecution[field])) {
        changed = true;
        changes.push({ kind: 'changed', nodeId: node.id, subject: node.type, field, before: oldExecution[field], after: newExecution[field] });
      }
    }
    if (!changed) unchangedNodes++;
  }
  const orphanLinks = (workflow: Workflow, nodeMap: Map<string, WorkflowNode>): JsonValue => workflow.links
    .filter((link) => !nodeMap.has(link.target))
    .map((link) => ({ source: link.source, sourceSlot: link.sourceSlot, target: link.target, targetSlot: link.targetSlot, ...(link.type !== undefined ? { type: link.type } : {}) }))
    .sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const oldOrphans = orphanLinks(before, previous);
  const newOrphans = orphanLinks(after, current);
  if (canonical(oldOrphans) !== canonical(newOrphans)) changes.push({ kind: 'changed', subject: '未解析终点的连接', field: 'links', before: oldOrphans, after: newOrphans });
  const notices = ['按节点 ID 对齐；节点重编号会被视为删除与新增，未知自定义节点参数按原始 widgets/inputs/properties 值比较。properties 保守包含配置与包元数据。'];
  if (before.notices.length || after.notices.length) notices.push('至少一侧存在解析范围或结构提示；差异结果仅覆盖已解析的外层执行字段，请结合检查报告查看。');
  if ([...before.notices, ...after.notices].some((notice) => notice.includes('子图'))) notices.push('子图内部未参与比较；外层零差异不表示整个工作流相同。');
  return { changes, unchangedNodes, comparable: true, notices };
}
