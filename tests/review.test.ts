import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyzeWorkflow } from '../src/core/analyze';
import { diffWorkflows } from '../src/core/diff';
import { parseWorkflow } from '../src/core/parse';
import { readWorkflowBytes } from '../src/io/import';
import { bytes, metadata, png } from './helpers/png-fixture';

function uiPair() {
  return {
    version: 1,
    state: { lastNodeId: 2, lastLinkId: 1, lastGroupId: 0, lastRerouteId: 0 },
    nodes: [
      { id: 1, type: 'Source', pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
        properties: {}, inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }] },
      { id: 2, type: 'SaveImage', pos: [300, 0], size: [200, 100], flags: {}, order: 1, mode: 0,
        properties: {}, inputs: [{ name: 'images', type: 'IMAGE', link: 1 }], outputs: [] },
    ],
    links: [{ id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'IMAGE' }],
  };
}

describe('independent correctness and security review', () => {
  it('does not label acyclic successors as cycle members', () => {
    const analysis = analyzeWorkflow(parseWorkflow({
      a: { class_type: 'A', inputs: { x: ['b', 0] } },
      b: { class_type: 'B', inputs: { x: ['a', 0] } },
      c: { class_type: 'C', inputs: { x: ['b', 0] } },
      d: { class_type: 'SaveImage', inputs: { images: ['c', 0] } },
      e: { class_type: 'E', inputs: { x: ['e', 0] } },
    }));
    const cycles = analysis.diagnostics.filter((item) => item.code === 'GRAPH_CYCLE');
    expect(cycles.map((item) => item.nodeIds).sort()).toEqual([['a', 'b'], ['e']]);
  });

  it('reports both sides of a UI port declaration inconsistent with the graph', () => {
    const raw = uiPair();
    raw.nodes[0].outputs[0].links = [];
    raw.nodes[1].inputs[0].link = 5;
    const notes = parseWorkflow(raw).notices.join('\n');
    expect(notes).toContain('输出槽');
    expect(notes).toContain('输入槽');
    expect(notes).toContain('5');
  });

  it('keeps model runtime availability unknown even with a node inventory', () => {
    const workflow = parseWorkflow({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
    });
    const result = analyzeWorkflow(workflow, {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['model.safetensors']] } } },
    });
    expect(result.dependencies.find((dependency) => dependency.kind === 'model')?.status).toBe('unknown');
  });

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])
    ('handles custom node type %s as data, without prototype lookup or crashes', (type) => {
      const workflow = parseWorkflow({ '1': { class_type: type, inputs: {} } });
      const result = analyzeWorkflow(workflow, {});
      expect(result.dependencies).toEqual([expect.objectContaining({ kind: 'node', name: type, status: 'missing' })]);
      expect(Object.prototype).not.toHaveProperty('polluted');
    });

  it('rejects dangerous input keys without invoking or installing properties', () => {
    const malicious = JSON.parse('{"1":{"class_type":"Custom","inputs":{"__proto__":{"polluted":true}}}}');
    expect(() => parseWorkflow(malicious)).toThrow();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('preserves unknown extensions without executing or mutating them', () => {
    const raw = { ...uiPair(), extra: { custom_extension: { script: 'fetch("https://example.test")', parameter: 17 } } };
    const before = JSON.stringify(raw);
    const workflow = parseWorkflow(raw);
    analyzeWorkflow(workflow);
    diffWorkflows(workflow, workflow);
    expect(workflow.raw).toEqual(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('detects an API value becoming a connection and a connection becoming a wrapped literal', () => {
    const first = { source: { class_type: 'Source', inputs: {} }, output: { class_type: 'SaveImage', inputs: { images: 'constant' } } };
    const connected = { source: first.source, output: { class_type: 'SaveImage', inputs: { images: ['source', 0] } } };
    const literal = { source: first.source, output: { class_type: 'SaveImage', inputs: { images: { __value__: ['source', 0] } } } };
    expect(diffWorkflows(parseWorkflow(first), parseWorkflow(connected)).changes.map((item) => item.field)).toContain('links');
    expect(diffWorkflows(parseWorkflow(connected), parseWorkflow(literal)).changes.map((item) => item.field)).toContain('inputs');
  });

  it('does not turn PNG import provenance into a diagnostic warning', async () => {
    const api = JSON.stringify({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'demo' } } });
    const fromJson = await readWorkflowBytes(bytes(api), 'demo.json');
    const fromPng = await readWorkflowBytes(png(metadata('tEXt', 'prompt', api)), 'demo.png');
    expect(analyzeWorkflow(fromPng).stats.warnings).toBe(analyzeWorkflow(fromJson).stats.warnings);
  });

  it('does not report valid top-level subgraph instance endpoints as missing nodes', () => {
    const raw = uiPair();
    const instanceType = 'd2719ec9-c56e-4493-8100-3e57c1fc7fc3';
    const workflow = parseWorkflow({
      ...raw,
      nodes: [raw.nodes[0]],
      subgraphs: [{ ...raw.nodes[1], type: instanceType }],
      definitions: { subgraphs: [{ id: instanceType, version: 1, nodes: [], links: [] }] },
    });
    const result = analyzeWorkflow(workflow, { Source: { input: {} } });
    expect(result.diagnostics.filter((item) => item.code === 'DANGLING_LINK')).toEqual([]);
    expect(workflow.notices.join(' ')).toContain('子图');
  });

  it('detects the builtin PrimitiveNode property that changes runtime string substitution', () => {
    const node = { id: 1, type: 'PrimitiveNode', widgets_values: ['%LoadImage.image%'],
      properties: { 'Run widget replace on values': false } };
    const before = parseWorkflow({ version: 1, nodes: [node] });
    const after = parseWorkflow({ version: 1, nodes: [{ ...node, properties: { 'Run widget replace on values': true } }] });
    expect(diffWorkflows(before, after).changes.length).toBeGreaterThan(0);
  });

  it('retains changes to officially supported non-string link type declarations', () => {
    const raw = uiPair();
    const before = parseWorkflow({ ...raw, links: [{ ...raw.links[0], type: ['IMAGE', 'MASK'] }] });
    const after = parseWorkflow({ ...raw, links: [{ ...raw.links[0], type: ['LATENT'] }] });
    expect(diffWorkflows(before, after).changes.length).toBeGreaterThan(0);
  });
});

describe('independent CLI review', () => {
  function cli(...args: string[]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
    });
    if (result.error) throw result.error;
    return result;
  }

  it('returns machine-readable JSON without npm banner noise', () => {
    const result = cli('examples/api-prompt.json', '--format', 'json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, workflow: { format: 'api' } });
  });

  it('prints help without requiring or opening an input file', () => {
    const result = cli('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--fail-on');
    expect(result.stderr).toBe('');
  });

  it('emits Markdown and permits diagnostics when --fail-on is none', () => {
    const result = cli('examples/broken-workflow.json', '--fail-on', 'none');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^# ComfyTrace inspection report/);
    expect(result.stdout).toMatch(/- Errors: [1-9]/);
    expect(result.stdout).toContain('## Diagnostics');
  });

  it('rejects directory inputs and malformed workflow contents with exit 2', () => {
    const directory = cli('examples');
    expect(directory.status).toBe(2);
    expect(directory.stderr).toContain('regular file');
    expect(cli('examples/README.md').status).toBe(2);
  });

  it('uses exit 1 for broken references and exit 2 for invalid options', () => {
    expect(cli('examples/broken-workflow.json').status).toBe(1);
    expect(cli('examples/api-prompt.json', '--format', 'html').status).toBe(2);
  });

  it('returns exit 2 for a cross-format comparison instead of claiming equivalence', () => {
    const result = cli('examples/api-prompt.json', '--compare', 'examples/platform-workflow.json', '--format', 'json');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).diff.comparable).toBe(false);
  });

  it('refuses to overwrite any existing file and leaves the input unchanged', () => {
    const path = 'examples/api-prompt.json';
    const before = readFileSync(path);
    expect(cli(path, '--out', path).status).toBe(2);
    expect(readFileSync(path)).toEqual(before);
    const existingOutput = 'examples/object-info.json';
    const existingBytes = readFileSync(existingOutput);
    expect(cli(path, '--out', existingOutput).status).toBe(2);
    expect(readFileSync(existingOutput)).toEqual(existingBytes);
  });
});
