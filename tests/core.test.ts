import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/core/parse';
import { analyzeWorkflow } from '../src/core/analyze';
import { diffWorkflows } from '../src/core/diff';

const api = () => ({
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'original-model.safetensors' } },
  '2': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: 42, steps: 20, noise: [1, 2] } },
  '3': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'ComfyTrace' }, _meta: { title: 'Result' } },
});

const ui = () => ({
  version: 0.4,
  nodes: [
    { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 0], mode: 0, widgets_values: ['original-model.safetensors'], inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }] },
    { id: 2, type: 'SaveImage', pos: [300, 0], mode: 0, widgets_values: ['ComfyTrace'], inputs: [{ name: 'images', type: 'MODEL', link: 1 }], outputs: [] },
  ],
  links: [[1, 1, 0, 2, 0, 'MODEL']],
});

describe('parseWorkflow', () => {
  it('normalizes an API prompt and preserves raw input without mutation', () => {
    const raw = api();
    const snapshot = JSON.stringify(raw);
    const parsed = parseWorkflow(raw, 'demo');
    expect(parsed.format).toBe('api');
    expect(parsed.name).toBe('demo');
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.links).toHaveLength(2);
    expect(parsed.nodes[2].title).toBe('Result');
    expect(parsed.raw).toBe(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('accepts the API wrapper and preserves numeric pairs and wrapped arrays as values', () => {
    const raw = { prompt: { '7': { class_type: 'CustomNode', inputs: { pair: [2, 3], list: { __value__: ['name', 0] } } } }, client_id: 'example' };
    const parsed = parseWorkflow(raw);
    expect(parsed.links).toHaveLength(0);
    expect(parsed.nodes[0].inputs.pair).toEqual([2, 3]);
    expect(parsed.raw).toBe(raw);
  });

  it('normalizes UI 0.4 tuple links and UI 1.0 object links identically', () => {
    const raw = ui();
    const first = parseWorkflow(raw);
    const second = parseWorkflow({ ...raw, version: 1, links: [{ id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'MODEL' }] });
    expect(first.links).toEqual(second.links);
    expect(first.notices).toEqual([]);
    expect(first.nodes[0].position).toEqual([0, 0]);
    expect(second.version).toBe('1');
  });

  it('accepts a linkless UI 1.0 graph', () => {
    expect(parseWorkflow({ version: 1, nodes: [] }).nodes).toEqual([]);
  });

  it('accepts numeric strings for UI slots without treating API string pairs as links', () => {
    const raw = ui();
    expect(parseWorkflow({ ...raw, links: [[1, 1, '0', 2, '0', 'MODEL']] }).links).toEqual(parseWorkflow(raw).links);
    expect(parseWorkflow({ ...raw, version: 1, links: [{ id: 1, origin_id: 1, origin_slot: '0', target_id: 2, target_slot: '0', type: 'MODEL' }] }).links).toEqual(parseWorkflow(raw).links);
    expect(parseWorkflow({ '1': { class_type: 'X', inputs: { constant: ['a', '0'] } } }).links).toEqual([]);
    expect(() => parseWorkflow({ ...raw, links: [[1, 1, '0.5', 2, 0, 'MODEL']] })).toThrow('非负整数');
  });

  it('reports unsupported subgraphs and floating links', () => {
    const parsed = parseWorkflow({ version: 1, nodes: [], definitions: { subgraphs: [{ id: 'subgraph-id', nodes: [] }] }, floatingLinks: [{ id: 1 }] });
    expect(parsed.notices.join(' ')).toContain('未展开子图');
    expect(parsed.notices.join(' ')).toContain('floatingLinks');
    expect(parseWorkflow({ version: 1, nodes: [], subgraphs: [{ id: 1, type: 'top-level-graph' }] }).notices.join(' ')).toContain('顶层 subgraphs');
  });

  it('rejects duplicate normalized node IDs and link IDs', () => {
    const raw = ui();
    expect(() => parseWorkflow({ ...raw, nodes: [raw.nodes[0], { ...raw.nodes[0], id: '1' }] })).toThrow('重复');
    expect(() => parseWorkflow({ ...raw, links: [raw.links[0], [...raw.links[0]]] })).toThrow('重复');
  });

  it.each([null, [], 1, 'json', {}, { nodes: {}, version: 1 }, { '1': { class_type: 'X' } }, { nodes: [{ id: 1 }], links: [] }])('rejects invalid structures %#', (raw) => {
    expect(() => parseWorkflow(raw)).toThrow('工作流解析失败');
  });

  it('rejects prototype pollution keys without mutating Object.prototype', () => {
    expect(() => parseWorkflow(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('不安全');
    expect(() => parseWorkflow(JSON.parse('{"1":{"class_type":"X","inputs":{"constructor":{}}}}'))).toThrow('不安全');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('rejects accessors before invoking them', () => {
    let invoked = false;
    const raw = Object.defineProperty({}, 'nodes', { enumerable: true, get() { invoked = true; return []; } });
    expect(() => parseWorkflow(raw)).toThrow('访问器');
    expect(invoked).toBe(false);
  });

  it('accepts shared JSON values but rejects real cycles', () => {
    const shared = { text: 'safe' };
    const workflow = parseWorkflow({ '1': { class_type: 'X', inputs: { a: shared, b: shared } } });
    expect(workflow.nodes[0].inputs.a).toEqual(workflow.nodes[0].inputs.b);
  });

  it('rejects circular references, exotic objects, non-finite numbers, and sparse arrays', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => parseWorkflow(circular)).toThrow('循环引用');
    expect(() => parseWorkflow({ nodes: [], extra: new Date() })).toThrow('普通 JSON');
    expect(() => parseWorkflow({ nodes: [], extra: Infinity })).toThrow('有限数');
    expect(() => parseWorkflow({ nodes: new Array(2) })).toThrow('稀疏数组');
  });

  it('rejects excessive depth and size before normalization', () => {
    let nested: unknown = null;
    for (let index = 0; index < 70; index++) nested = { next: nested };
    expect(() => parseWorkflow(nested)).toThrow('嵌套深度');
    expect(() => parseWorkflow({ version: 1, nodes: Array.from({ length: 2001 }, (_, id) => ({ id, type: 'X' })) })).toThrow('2000');
    expect(() => parseWorkflow({ version: 1, nodes: [], links: Array.from({ length: 10001 }, (_, id) => [id, 1, 0, 2, 0, 'X']) })).toThrow('10000');
    expect(() => parseWorkflow({ nodes: [], extra: 'a'.repeat(16 * 1024 * 1024 + 1) })).toThrow('16 MiB');
  });

  it('rejects negative or fractional connection slots', () => {
    expect(() => parseWorkflow({ '1': { class_type: 'X', inputs: { a: ['2', -1] } } })).toThrow('非负整数');
    expect(() => parseWorkflow({ ...ui(), links: [[1, 1, 0.5, 2, 0, 'MODEL']] })).toThrow('非负整数');
  });

  it('reports declared port bounds and inconsistent input/output link references', () => {
    const raw = ui();
    raw.nodes[0].outputs[0].links = [99];
    raw.nodes[1].inputs[0].link = 88;
    const parsed = parseWorkflow({ ...raw, links: [[1, 1, 3, 2, 9, 'MODEL']] });
    expect(parsed.notices.join(' ')).toContain('不存在的连接 99');
    expect(parsed.notices.join(' ')).toContain('不存在的连接 88');
    expect(parsed.notices.join(' ')).toContain('输出槽 3');
    expect(parsed.notices.join(' ')).toContain('输入槽 9');
  });
});

describe('analyzeWorkflow', () => {
  it('builds deterministic topology layers and finds model references', () => {
    const analysis = analyzeWorkflow(parseWorkflow(api()));
    expect(analysis.layers).toEqual([['1'], ['2'], ['3']]);
    expect(analysis.stats).toMatchObject({ nodes: 3, links: 2, models: 1, errors: 0, warnings: 0 });
    expect(analysis.dependencies.find((item) => item.kind === 'model')).toMatchObject({ name: 'original-model.safetensors', status: 'unknown', nodeIds: ['1'] });
    expect(analysis.dependencies.filter((item) => item.kind === 'node').every((item) => item.status === 'unknown')).toBe(true);
  });

  it('only assigns node availability from supplied object_info', () => {
    const workflow = parseWorkflow(api());
    const analysis = analyzeWorkflow(workflow, { CheckpointLoaderSimple: {}, SaveImage: { output_node: true } });
    expect(analysis.dependencies.find((item) => item.name === 'CheckpointLoaderSimple')?.status).toBe('available');
    expect(analysis.dependencies.find((item) => item.name === 'KSampler')?.status).toBe('missing');
    expect(analysis.dependencies.find((item) => item.kind === 'model')?.status).toBe('unknown');
    expect(analysis.diagnostics.some((item) => item.code === 'MISSING_NODE_TYPE')).toBe(true);
  });

  it('does not trust inherited inventory entries or malformed definitions', () => {
    const inventory = Object.create({ KSampler: {} }) as Record<string, unknown>;
    inventory.SaveImage = null;
    const analysis = analyzeWorkflow(parseWorkflow(api()), inventory);
    expect(analysis.dependencies.find((item) => item.name === 'KSampler')?.status).toBe('missing');
    expect(analysis.dependencies.find((item) => item.name === 'SaveImage')?.status).toBe('unknown');
    expect(analysis.diagnostics.some((item) => item.code === 'INVALID_INVENTORY_ENTRY')).toBe(true);
  });

  it('uses known loader positions without guessing arbitrary widget meanings', () => {
    const raw = { version: 1, nodes: [
      { id: 1, type: 'DualCLIPLoader', widgets_values: ['clip-a.safetensors', 'clip-b.safetensors', 'flux'] },
      { id: 2, type: 'UnknownCustomLoader', widgets_values: ['not-inferred.safetensors'] },
      { id: 3, type: 'LoraLoader', widgets_values: ['lora.safetensors', 0.8, 1] },
      { id: 4, type: 'VAELoader', widgets_values: ['vae.safetensors'] },
    ] };
    const models = analyzeWorkflow(parseWorkflow(raw)).dependencies.filter((item) => item.kind === 'model');
    expect(models.map((item) => item.name)).toEqual(['clip-a.safetensors', 'clip-b.safetensors', 'lora.safetensors', 'vae.safetensors']);
  });

  it('collects declared model metadata and deduplicates shared models', () => {
    const raw = { version: 1, nodes: [
      { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['same.safetensors'], properties: { cnr_id: 'comfy-core', models: [{ name: 'same.safetensors' }, { name: 'aux.bin' }] } },
      { id: 2, type: 'CheckpointLoaderSimple', widgets_values: ['same.safetensors'] },
    ] };
    const analysis = analyzeWorkflow(parseWorkflow(raw));
    expect(analysis.stats.models).toBe(2);
    expect(analysis.dependencies.find((item) => item.name === 'same.safetensors')?.nodeIds).toEqual(['1', '2']);
    expect(analysis.dependencies.find((item) => item.kind === 'node')?.source).toContain('comfy-core');
  });

  it('uses the legacy checkpoint widget index and named widget dictionaries', () => {
    const raw = { version: 1, nodes: [
      { id: 1, type: 'CheckpointLoader', widgets_values: ['legacy-config.yaml', 'legacy-model.ckpt'] },
      { id: 2, type: 'VAELoader', widgets_values: { vae_name: 'named-vae.safetensors' } },
    ] };
    const models = analyzeWorkflow(parseWorkflow(raw)).dependencies.filter((item) => item.kind === 'model');
    expect(models.map((item) => item.name)).toEqual(['legacy-model.ckpt', 'named-vae.safetensors']);
    expect(models[0].source).toContain('[1]');
    expect(models[1].source).toContain('.vae_name');
  });

  it('flags dangling nodes and multiply occupied target slots', () => {
    const raw = { ...ui(), links: [[1, 404, 0, 2, 0, 'MODEL'], [2, 1, 0, 2, 0, 'MODEL']] };
    const codes = analyzeWorkflow(parseWorkflow(raw)).diagnostics.map((item) => item.code);
    expect(codes).toContain('DANGLING_LINK');
    expect(codes).toContain('MULTIPLE_INPUT_LINKS');
  });

  it('finds only cycle members, not downstream nodes', () => {
    const workflow = parseWorkflow({
      '1': { class_type: 'A', inputs: { source: ['2', 0] } },
      '2': { class_type: 'B', inputs: { source: ['1', 0] } },
      '3': { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
      '4': { class_type: 'X', inputs: {} },
    });
    const analysis = analyzeWorkflow(workflow);
    expect(analysis.diagnostics.find((item) => item.code === 'GRAPH_CYCLE')?.nodeIds).toEqual(['1', '2']);
    expect(analysis.layers).toEqual([['4']]);
  });

  it('finds self loops and handles a long chain iteratively', () => {
    const self = analyzeWorkflow(parseWorkflow({ '1': { class_type: 'X', inputs: { source: ['1', 0] } } }));
    expect(self.diagnostics.find((item) => item.code === 'GRAPH_CYCLE')?.nodeIds).toEqual(['1']);
    const chain: Record<string, unknown> = {};
    for (let index = 0; index < 2000; index++) chain[String(index)] = { class_type: index === 1999 ? 'SaveImage' : 'X', inputs: index ? { source: [String(index - 1), 0] } : {} };
    expect(analyzeWorkflow(parseWorkflow(chain)).layers).toHaveLength(2000);
  });

  it('treats isolation, mute, and bypass as informative, not execution failures', () => {
    const analysis = analyzeWorkflow(parseWorkflow({ version: 1, nodes: [{ id: 1, type: 'X', mode: 2 }, { id: 2, type: 'Y', mode: 4 }, { id: 3, type: 'SaveImage' }] }));
    expect(analysis.stats.errors).toBe(0);
    expect(analysis.diagnostics.find((item) => item.code === 'MUTED_NODE')?.severity).toBe('info');
    expect(analysis.diagnostics.find((item) => item.code === 'BYPASSED_NODE')?.severity).toBe('info');
    expect(analysis.diagnostics.filter((item) => item.code === 'ISOLATED_NODE')).toHaveLength(3);
  });

  it('recognizes custom outputs only with explicit inventory evidence', () => {
    const workflow = parseWorkflow({ '1': { class_type: 'MySaveCustom', inputs: {} } });
    expect(analyzeWorkflow(workflow).diagnostics.some((item) => item.code === 'NO_KNOWN_OUTPUT')).toBe(true);
    expect(analyzeWorkflow(workflow, { MySaveCustom: { output_node: true } }).diagnostics.some((item) => item.code === 'NO_KNOWN_OUTPUT')).toBe(false);
  });

  it('does not classify an embedded subgraph UUID as a missing plugin', () => {
    const workflow = parseWorkflow({ version: 1, nodes: [{ id: 1, type: 'graph-uuid' }], definitions: { subgraphs: [{ id: 'graph-uuid', nodes: [] }] } });
    const analysis = analyzeWorkflow(workflow, {});
    expect(analysis.dependencies).toEqual([]);
    expect(analysis.diagnostics.some((item) => item.code === 'MISSING_NODE_TYPE')).toBe(false);
    expect(analysis.diagnostics.some((item) => item.message.includes('未展开子图'))).toBe(true);
  });

  it('keeps outer subgraph instances as endpoints without analyzing internal graphs', () => {
    const raw = { version: 1,
      nodes: [{ id: 2, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE', link: 1 }] }],
      subgraphs: [{ id: 1, type: 'graph-uuid', outputs: [{ name: 'image', type: 'IMAGE', links: [1] }] }],
      definitions: { subgraphs: [{ id: 'graph-uuid', nodes: [{ id: 99, type: 'InternalUnknown' }] }] },
      links: [{ id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'IMAGE' }],
    };
    const workflow = parseWorkflow(raw);
    const analysis = analyzeWorkflow(workflow, { SaveImage: { output_node: true } });
    expect(workflow.nodes.map((node) => node.id)).toEqual(['2', '1']);
    expect(analysis.diagnostics.some((item) => item.code === 'DANGLING_LINK')).toBe(false);
    expect(analysis.dependencies.map((item) => item.name)).toEqual(['SaveImage']);
    expect(analysis.layers).toEqual([['1'], ['2']]);
  });

  it('does not expect frontend-only helper nodes in the backend inventory', () => {
    const workflow = parseWorkflow({ version: 1, nodes: ['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode'].map((type, id) => ({ id, type })) });
    expect(analyzeWorkflow(workflow, {}).dependencies).toEqual([]);
    const apiWorkflow = parseWorkflow({ '1': { class_type: 'PrimitiveNode', inputs: {} } });
    expect(analyzeWorkflow(apiWorkflow, {}).dependencies[0].status).toBe('missing');
  });
});

describe('diffWorkflows', () => {
  it('ignores canvas positions, titles, node order, and link IDs', () => {
    const raw = ui();
    const moved = JSON.parse(JSON.stringify(raw));
    moved.nodes[0].pos = [999, 777];
    moved.nodes[0].title = 'Edited label';
    moved.nodes[0].outputs[0].links = [42];
    moved.nodes[1].inputs[0].link = 42;
    moved.links[0][0] = 42;
    moved.nodes.reverse();
    moved.extra = { ds: { scale: 2, offset: [0, 1] } };
    const difference = diffWorkflows(parseWorkflow(raw), parseWorkflow(moved));
    expect(difference.comparable).toBe(true);
    expect(difference.changes).toEqual([]);
    expect(difference.unchangedNodes).toBe(2);
  });

  it('compares UI tuple and object link versions semantically', () => {
    const raw = ui();
    expect(diffWorkflows(parseWorkflow(raw), parseWorkflow({ ...raw, version: 1, links: [{ id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'MODEL' }] })).changes).toEqual([]);
  });

  it('tracks precise API values and wiring with before/after evidence', () => {
    const raw = api();
    const changed = api();
    changed['2'].inputs.steps = 30;
    changed['3'].inputs.images = ['1', 0];
    const difference = diffWorkflows(parseWorkflow(raw), parseWorkflow(changed));
    expect(difference.changes.map((item) => [item.nodeId, item.field])).toEqual([['2', 'inputs'], ['3', 'links']]);
    expect(difference.changes[0].before).toMatchObject({ steps: 20 });
    expect(difference.changes[0].after).toMatchObject({ steps: 30 });
    expect(difference.unchangedNodes).toBe(1);
  });

  it('detects mode, type, and widget changes', () => {
    const raw = ui();
    const changed = ui();
    changed.nodes[0].mode = 4;
    changed.nodes[0].type = 'CheckpointLoader';
    changed.nodes[0].widgets_values = ['different.safetensors'];
    expect(diffWorkflows(parseWorkflow(raw), parseWorkflow(changed)).changes.map((item) => item.field)).toEqual(['type', 'mode', 'widgets']);
  });

  it('retains execution properties and unknown custom configuration changes', () => {
    const before = { version: 1, nodes: [{ id: 1, type: 'PrimitiveNode', widgets_values: ['%Node.seed%'], properties: { 'Run widget replace on values': false, ver: '1' } }] };
    const after = { version: 1, nodes: [{ id: 1, type: 'PrimitiveNode', widgets_values: ['%Node.seed%'], properties: { 'Run widget replace on values': true, ver: '2' } }] };
    const diff = diffWorkflows(parseWorkflow(before), parseWorkflow(after));
    expect(diff.changes.map((item) => item.field)).toEqual(['properties']);
    expect(diff.changes[0].after).toMatchObject({ 'Run widget replace on values': true, ver: '2' });
  });

  it('retains array and numeric link types in the semantic comparison', () => {
    const before = parseWorkflow({ ...ui(), links: [[1, 1, 0, 2, 0, ['MODEL', 'IMAGE']]] });
    const after = parseWorkflow({ ...ui(), links: [[1, 1, 0, 2, 0, 0]] });
    expect(before.links[0].type).toEqual(['MODEL', 'IMAGE']);
    expect(after.links[0].type).toBe(0);
    expect(diffWorkflows(before, after).changes.map((item) => item.field)).toEqual(['links']);
  });

  it('tracks added and removed nodes', () => {
    const before = parseWorkflow({ '1': { class_type: 'X', inputs: {} } });
    const after = parseWorkflow({ '2': { class_type: 'Y', inputs: {} } });
    expect(diffWorkflows(before, after).changes.map((item) => [item.kind, item.nodeId])).toEqual([['removed', '1'], ['added', '2']]);
  });

  it('retains differences in broken input declarations and links to absent targets', () => {
    const before = ui();
    const after = ui();
    after.nodes[1].inputs[0].link = 999;
    expect(diffWorkflows(parseWorkflow(before), parseWorkflow(after)).changes.map((item) => item.field)).toContain('inputs');
    const danglingBefore = parseWorkflow({ version: 1, nodes: [], links: [[1, 1, 0, 2, 0, 'IMAGE']] });
    const danglingAfter = parseWorkflow({ version: 1, nodes: [], links: [[1, 3, 0, 2, 0, 'IMAGE']] });
    expect(diffWorkflows(danglingBefore, danglingAfter).changes).toHaveLength(1);
  });

  it('ignores object key order without mutating either input', () => {
    const before = { '1': { class_type: 'SaveImage', inputs: { config: { a: 1, b: 2 }, text: 'one' } } };
    const after = { '1': { inputs: { text: 'one', config: { b: 2, a: 1 } }, class_type: 'SaveImage' } };
    const snapshot = JSON.stringify(after);
    expect(diffWorkflows(parseWorkflow(before), parseWorkflow(after)).changes).toEqual([]);
    expect(JSON.stringify(after)).toBe(snapshot);
  });

  it('refuses to claim cross-format semantic equivalence', () => {
    const difference = diffWorkflows(parseWorkflow(ui()), parseWorkflow(api()));
    expect(difference.comparable).toBe(false);
    expect(difference.changes).toEqual([]);
    expect(difference.notices[0]).toContain('跨格式');
  });
});
