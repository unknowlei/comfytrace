import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeWorkflow } from './core/analyze';
import { diffWorkflows } from './core/diff';
import { readWorkflowBytes, parseInventory, MAX_JSON_BYTES } from './io/import';
import { MAX_PNG_BYTES } from './io/png';
import { createMarkdownReport } from './io/export';

const usage = `ComfyTrace - offline ComfyUI workflow inspection

Usage: npm run inspect -- <workflow.json|image.png> [options]

  --compare <file>        Compare the input (before) with a revision (after)
  --inventory <file>      Use an offline ComfyUI /object_info snapshot
  --format json|markdown Output format; defaults to markdown
  --out <file>           Write a NEW report file instead of stdout
  --fail-on error|warning|none  Diagnostic exit threshold; defaults to error
  --help                 Show usage

Exit codes: 0 = below threshold, 1 = diagnostic threshold met, 2 = input error.
No network calls; inputs are never modified. Reports may contain private text.
`;

async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) throw new Error(`File must be a regular file under ${limit / 1024 / 1024} MiB: ${path}`);
  const data = await readFile(path);
  if (data.length > limit) throw new Error('File grew beyond the size limit while reading.');
  return data;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    compare: { type: 'string' }, inventory: { type: 'string' }, format: { type: 'string', default: 'markdown' },
    out: { type: 'string' }, 'fail-on': { type: 'string', default: 'error' }, help: { type: 'boolean' },
  } });
  if (values.help) { process.stdout.write(usage); return; }
  if (positionals.length !== 1) throw new Error(usage);
  if (!['json', 'markdown'].includes(values.format!)) throw new Error('--format must be json or markdown.');
  if (!['none', 'error', 'warning'].includes(values['fail-on']!)) throw new Error('--fail-on must be error, warning, or none.');
  const input = positionals[0];
  const workflow = await readWorkflowBytes(await boundedRead(input, MAX_PNG_BYTES), input);
  const inventory = values.inventory ? parseInventory((await boundedRead(values.inventory, MAX_JSON_BYTES)).toString('utf8')) : undefined;
  const analysis = analyzeWorkflow(workflow, inventory);
  const diff = values.compare ? diffWorkflows(workflow, await readWorkflowBytes(await boundedRead(values.compare, MAX_PNG_BYTES), values.compare)) : undefined;
  const report = values.format === 'json'
    ? `${JSON.stringify({ schemaVersion: 1, workflow: { name: workflow.name, format: workflow.format, version: workflow.version, notices: workflow.notices, provenance: workflow.provenance }, analysis, diff }, null, 2)}\n`
    : createMarkdownReport(workflow, analysis, diff);
  if (values.out) {
    const output = resolve(values.out);
    if ([input, values.compare, values.inventory].filter(Boolean).some((path) => resolve(path!) === output)) throw new Error('Output cannot replace an input file.');
    await writeFile(output, report, { encoding: 'utf8', flag: 'wx' });
    process.stderr.write(`Report written: ${output}\n`);
  } else process.stdout.write(report);
  if (diff && !diff.comparable) { process.exitCode = 2; return; }
  if (values['fail-on'] !== 'none' && (analysis.stats.errors > 0 || (values['fail-on'] === 'warning' && analysis.stats.warnings > 0))) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`ComfyTrace: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
