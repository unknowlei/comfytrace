import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readInventoryFile, parseInventory, readWorkflowBytes, readWorkflowFile, MAX_JSON_BYTES } from '../src/io/import';
import { createDependencyManifest, createMarkdownReport, downloadText } from '../src/io/export';
import { crc32, extractPngMetadata, isPng, MAX_METADATA_BYTES, MAX_PNG_BYTES } from '../src/io/png';
import { analyzeWorkflow } from '../src/core/analyze';
import type { Analysis, DiffResult, Workflow } from '../src/core/types';
import { demoApi, demoInventory, demoRevision, demoWorkflow } from '../src/data/demo';
import { bytes, chunk, concat, metadata, png, signature } from './helpers/png-fixture';

const apiText = JSON.stringify({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'demo' } } });
const uiText = JSON.stringify(demoWorkflow);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PNG metadata extraction', () => {
  it('matches independent published CRC-32 check values', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('IEND'))).toBe(0xae426082);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it.each(['tEXt', 'zTXt', 'comf'] as const)('reads valid %s workflow chunks', async (type) => {
    expect(await extractPngMetadata(png(metadata(type, 'workflow', uiText)))).toEqual({ workflow: uiText });
  });

  it.each([false, true])('reads iTXt with compression=%s and nonempty language fields', async (compressed) => {
    const text = '{"title":"\u4e2d\u6587 \ud83c\udfa8"}';
    expect(await extractPngMetadata(png(metadata('iTXt', 'workflow', text, compressed)))).toEqual({ workflow: text });
  });

  it('reads prompt and workflow together and preserves their distinct payloads', async () => {
    expect(await extractPngMetadata(png(metadata('tEXt', 'workflow', uiText), metadata('zTXt', 'prompt', apiText))))
      .toEqual({ workflow: uiText, prompt: apiText });
  });

  it('reads APNG comf metadata after image data', async () => {
    const base = png();
    const input = concat(base.subarray(0, base.length - 12), metadata('comf', 'prompt', apiText), chunk('IEND'));
    expect((await extractPngMetadata(input)).prompt).toBe(apiText);
  });

  it('respects typed-array byte offsets', async () => {
    const image = png(metadata('tEXt', 'prompt', apiText));
    const padded = concat(bytes('prefix'), image, bytes('suffix'));
    expect((await extractPngMetadata(padded.subarray(6, 6 + image.length))).prompt).toBe(apiText);
  });

  it('accepts Latin-1 text without silently replacing invalid UTF-8 bytes', async () => {
    const raw = concat(bytes('workflow'), Uint8Array.of(0, 0xe9));
    expect((await extractPngMetadata(png(chunk('tEXt', raw)))).workflow).toBe('\u00e9');
  });

  it('ignores unrelated metadata and cannot set prototype keys', async () => {
    const result = await extractPngMetadata(png(metadata('tEXt', '__proto__', '{"polluted":true}'), metadata('tEXt', 'prompt', apiText)));
    expect(Object.keys(result)).toEqual(['prompt']);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('requires all eight PNG signature bytes', async () => {
    expect(isPng(signature)).toBe(true);
    expect(isPng(signature.subarray(0, 7))).toBe(false);
    const bad = png();
    bad[7] ^= 1;
    await expect(extractPngMetadata(bad)).rejects.toThrow();
  });

  it('rejects oversized PNG input before inspecting data', async () => {
    await expect(extractPngMetadata(new Uint8Array(MAX_PNG_BYTES + 1))).rejects.toThrow('50 MiB');
  });

  it('rejects a truncated chunk header', async () => {
    const image = png(metadata('tEXt', 'prompt', apiText));
    await expect(extractPngMetadata(image.subarray(0, 38))).rejects.toThrow();
  });

  it('rejects declared chunk lengths outside the file', async () => {
    const image = png(metadata('tEXt', 'prompt', apiText));
    new DataView(image.buffer).setUint32(33, 0xffffffff);
    await expect(extractPngMetadata(image)).rejects.toThrow();
  });

  it('rejects changed payload bytes with an unchanged CRC', async () => {
    const image = png(metadata('tEXt', 'prompt', apiText));
    image[48] ^= 1;
    await expect(extractPngMetadata(image)).rejects.toThrow();
  });

  it('requires a valid first IHDR chunk', async () => {
    await expect(extractPngMetadata(concat(signature, metadata('tEXt', 'prompt', apiText), chunk('IEND')))).rejects.toThrow('IHDR');
    await expect(extractPngMetadata(concat(signature, chunk('IHDR', new Uint8Array(12)), chunk('IEND')))).rejects.toThrow('IHDR');
  });

  it('requires an IEND chunk even after finding metadata', async () => {
    const image = png(metadata('tEXt', 'prompt', apiText));
    await expect(extractPngMetadata(image.subarray(0, image.length - 12))).rejects.toThrow('IEND');
  });

  it('rejects an IEND chunk with data', async () => {
    const image = png(metadata('tEXt', 'prompt', apiText));
    await expect(extractPngMetadata(concat(image.subarray(0, image.length - 12), chunk('IEND', Uint8Array.of(1))))).rejects.toThrow('IEND');
  });

  it('reports absence of ComfyUI metadata', async () => {
    await expect(extractPngMetadata(png())).rejects.toThrow('ComfyUI');
    await expect(extractPngMetadata(png(metadata('tEXt', 'Software', 'image editor')))).rejects.toThrow('ComfyUI');
  });

  it.each(['workflow', 'prompt'])('rejects duplicate %s metadata across chunk types', async (key) => {
    await expect(extractPngMetadata(png(metadata('tEXt', key, apiText), metadata('zTXt', key, apiText)))).rejects.toThrow(key);
  });

  it.each(['', 'a'.repeat(80)])('rejects invalid PNG text keyword %j', async (key) => {
    await expect(extractPngMetadata(png(metadata('tEXt', key, apiText)))).rejects.toThrow();
  });

  it('rejects a text chunk without a keyword terminator', async () => {
    await expect(extractPngMetadata(png(chunk('tEXt', bytes('workflow'))))).rejects.toThrow();
  });

  it('rejects unsupported zTXt compression', async () => {
    const data = concat(bytes('prompt'), Uint8Array.of(0, 1), deflateSync(bytes(apiText)));
    await expect(extractPngMetadata(png(chunk('zTXt', data)))).rejects.toThrow('zTXt');
  });

  it('rejects invalid zlib streams', async () => {
    const data = concat(bytes('prompt'), Uint8Array.of(0, 0, 0, 1, 2, 3));
    await expect(extractPngMetadata(png(chunk('zTXt', data)))).rejects.toThrow();
  });

  it.each([Uint8Array.of(2, 0, 0, 0), Uint8Array.of(0, 1, 0, 0), Uint8Array.of(0, 0, 65, 65)])
    ('rejects invalid or unterminated iTXt headers %j', async (header) => {
      await expect(extractPngMetadata(png(chunk('iTXt', concat(bytes('prompt'), Uint8Array.of(0), header))))).rejects.toThrow('iTXt');
    });

  it('limits uncompressed metadata', async () => {
    await expect(extractPngMetadata(png(metadata('tEXt', 'workflow', 'x'.repeat(MAX_METADATA_BYTES + 1))))).rejects.toThrow('8 MiB');
  });

  it.each(['zTXt', 'iTXt'] as const)('stops %s decompression bombs at the decoded-byte budget', async (type) => {
    const image = png(metadata(type, 'workflow', 'x'.repeat(MAX_METADATA_BYTES + 1), true));
    expect(image.length).toBeLessThan(20_000);
    await expect(extractPngMetadata(image)).rejects.toThrow('8 MiB');
  });

  it('shares the decoded-byte budget across metadata chunks', async () => {
    const text = 'x'.repeat(MAX_METADATA_BYTES / 2 + 1);
    await expect(extractPngMetadata(png(metadata('zTXt', 'workflow', text), metadata('zTXt', 'prompt', text)))).rejects.toThrow('8 MiB');
  });
});

describe('local workflow and inventory import', () => {
  it('imports a prompt-only PNG as an API graph', async () => {
    const workflow = await readWorkflowBytes(png(metadata('tEXt', 'prompt', apiText)), 'image.png');
    expect(workflow.format).toBe('api');
    expect(workflow.nodes[0].type).toBe('SaveImage');
    expect(workflow.provenance).toContain('prompt');
    expect(analyzeWorkflow(workflow).stats.warnings).toBe(0);
  });

  it('prefers UI workflow metadata when both representations exist', async () => {
    const workflow = await readWorkflowBytes(png(metadata('tEXt', 'workflow', uiText), metadata('tEXt', 'prompt', apiText)));
    expect(workflow.format).toBe('ui');
    expect(workflow.nodes).toHaveLength(demoWorkflow.nodes.length);
  });

  it('does not silently hide invalid workflow metadata behind a valid prompt', async () => {
    await expect(readWorkflowBytes(png(metadata('tEXt', 'workflow', '{broken'), metadata('tEXt', 'prompt', apiText)))).rejects.toThrow();
  });

  it('detects PNG content even when its filename has a JSON suffix', async () => {
    expect((await readWorkflowBytes(png(metadata('tEXt', 'prompt', apiText)), 'image.json')).format).toBe('api');
  });

  it('accepts UTF-8 BOM in JSON files and PNG payloads', async () => {
    expect((await readWorkflowBytes(bytes('\ufeff' + apiText))).format).toBe('api');
    expect((await readWorkflowBytes(png(metadata('tEXt', 'prompt', '\ufeff' + apiText)))).format).toBe('api');
  });

  it('rejects invalid JSON, Markdown code fences and invalid UTF-8', async () => {
    await expect(readWorkflowBytes(bytes('{'))).rejects.toThrow('JSON');
    await expect(readWorkflowBytes(bytes('```json\n' + apiText + '\n```'))).rejects.toThrow('JSON');
    await expect(readWorkflowBytes(Uint8Array.of(0xff, 0xfe))).rejects.toThrow();
  });

  it('rejects a PNG filename containing JSON instead of PNG bytes', async () => {
    await expect(readWorkflowBytes(bytes(apiText), 'fake.PNG')).rejects.toThrow('PNG');
  });

  it('enforces JSON byte size before JSON parsing', async () => {
    await expect(readWorkflowBytes(new Uint8Array(MAX_JSON_BYTES + 1))).rejects.toThrow('8 MiB');
  });

  it('rejects oversized workflow files before reading their contents', async () => {
    const arrayBuffer = vi.fn();
    await expect(readWorkflowFile({ size: MAX_PNG_BYTES + 1, arrayBuffer } as unknown as File)).rejects.toThrow('50 MiB');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('reads local File inputs without using network APIs', async () => {
    const fetch = vi.fn(() => { throw new Error('Network access is forbidden in this test.'); });
    const xhr = vi.fn(() => { throw new Error('XHR access is forbidden in this test.'); });
    const socket = vi.fn(() => { throw new Error('Socket access is forbidden in this test.'); });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('WebSocket', socket);
    const workflow = await readWorkflowFile(new File([apiText], 'local.json', { type: 'application/json' }));
    const inventory = await readInventoryFile(new File([JSON.stringify(demoInventory)], 'object_info.json'));
    expect(workflow.format).toBe('api');
    expect(Object.keys(inventory).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  it('accepts a valid inventory and its BOM-prefixed form', () => {
    const inventory = { SaveImage: { input: { required: { images: ['IMAGE'] } }, output_node: true } };
    expect(parseInventory(JSON.stringify(inventory))).toEqual(inventory);
    expect(parseInventory('\ufeff' + JSON.stringify(inventory))).toEqual(inventory);
  });

  it.each([null, [], {}, { Bad: 1 }, { Bad: [] }, { Bad: {} },
    { Bad: { input: null } }, { Bad: { input: [] } }, { Bad: { input: 'invalid' } },
    { Bad: { input: { required: null } } }, { Bad: { input: { required: [] } } },
    { Bad: { input: { required: { image: 'IMAGE' } } } }, { Bad: { input: { required: { image: [] } } } },
  ])('rejects malformed inventory %j', (input) => {
    expect(() => parseInventory(JSON.stringify(input))).toThrow();
  });

  it('bounds inventory byte size and entry count', () => {
    expect(() => parseInventory(' '.repeat(MAX_JSON_BYTES + 1))).toThrow('8 MiB');
    const huge = Object.fromEntries(Array.from({ length: 20_001 }, (_, index) => [String(index), { input: {} }]));
    expect(() => parseInventory(JSON.stringify(huge))).toThrow('20,000');
  });

  it('rejects oversized inventory files before reading their contents', async () => {
    const text = vi.fn();
    await expect(readInventoryFile({ size: MAX_JSON_BYTES + 1, text } as unknown as File)).rejects.toThrow('8 MiB');
    expect(text).not.toHaveBeenCalled();
  });
});

describe('report and manifest export', () => {
  const attack = '![tracking](https://example.test/pixel) | <script>alert(1)</script>\n# forged heading';
  const workflow: Workflow = { name: attack, version: attack, format: 'api', nodes: [], links: [], raw: {}, notices: [attack] };
  const analysis: Analysis = {
    diagnostics: [{ code: attack, severity: 'warning', title: attack, message: attack, nodeIds: [attack] }],
    dependencies: [{ kind: 'model', name: attack, source: attack, nodeIds: [attack], status: 'unknown' }],
    layers: [], stats: { nodes: 0, links: 0, nodeTypes: 0, models: 1, errors: 0, warnings: 1 },
  };
  const diff: DiffResult = { comparable: true, unchangedNodes: 0, notices: [attack], changes: [
    { kind: 'changed', subject: attack, field: attack, before: attack, after: { value: attack } },
  ] };

  it('escapes file-derived Markdown, HTML, table separators and injected headings', () => {
    const report = createMarkdownReport(workflow, analysis, diff);
    expect(report).not.toContain('![tracking]');
    expect(report).not.toContain('<script>');
    expect(report).not.toMatch(/^# forged heading/m);
    expect(report).toContain('\\!\\[tracking\\]');
    expect(report).toContain('\\|');
    expect(report).toContain('\\<script\\>');
    expect(report).toContain('Review before sharing');
  });

  it('bounds values in Markdown changes and handles missing values', () => {
    const report = createMarkdownReport(workflow, analysis, { ...diff, changes: [
      { kind: 'added', subject: 'node', field: 'text', after: 'x'.repeat(5000) },
    ] });
    expect(report).toContain('Before: (none)');
    expect(report).toContain('truncated');
    expect(report).not.toContain('x'.repeat(1201));
  });

  it('exports dependency data as parseable JSON without execution or markup', () => {
    const manifest = JSON.parse(createDependencyManifest(workflow, analysis));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.workflow).toBe(attack);
    expect(manifest.dependencies).toEqual(analysis.dependencies);
    expect(manifest.scope).toContain('not a package lockfile');
  });

  it('downloads via a local Blob, sanitizes filenames and revokes the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-fixture');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append } });
    vi.stubGlobal('window', { setTimeout });
    downloadText('../bad\\name:<script>\u0000.md', 'local report');
    expect(anchor.href).toBe('blob:local-fixture');
    expect(anchor.download).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-fixture');
  });
});

describe('synthetic demo artifacts', () => {
  it.each([demoWorkflow, demoRevision])('includes official required UI node fields', (workflow) => {
    for (const node of workflow.nodes) {
      for (const key of ['id', 'type', 'pos', 'size', 'flags', 'order', 'mode', 'properties']) {
        expect(node, `Node ${node.id} is missing ${key}`).toHaveProperty(key);
      }
    }
  });

  it('ships independent demo revisions and importable UI/API examples', async () => {
    expect(demoRevision).not.toBe(demoWorkflow);
    expect(demoRevision.nodes[0].pos).not.toEqual(demoWorkflow.nodes[0].pos);
    expect((await readWorkflowBytes(bytes(JSON.stringify(demoWorkflow)))).format).toBe('ui');
    expect((await readWorkflowBytes(bytes(JSON.stringify(demoApi)))).format).toBe('api');
    expect(Object.keys(parseInventory(JSON.stringify(demoInventory))).length).toBeGreaterThan(0);
  });
});
