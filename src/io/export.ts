import type { Analysis, DiffResult, JsonValue, Workflow } from '../core/types';

function md(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+.!|<>-]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

function value(input: JsonValue | undefined): string {
  if (input === undefined) return '(none)';
  const text = JSON.stringify(input);
  return md(text.length > 1200 ? `${text.slice(0, 1200)}... [truncated]` : text);
}

export function createMarkdownReport(workflow: Workflow, analysis: Analysis, diff?: DiffResult): string {
  const lines = [
    '# ComfyTrace inspection report', '',
    `**Workflow:** ${md(workflow.name)}`, `**Format:** ${workflow.format} / ${md(workflow.version)}`,
    ...(workflow.provenance ? [`**Source:** ${md(workflow.provenance)}`] : []), '',
    '> Static inspection only. No workflow was executed. Installation and runtime compatibility are not guaranteed.',
    '> This report may contain prompts, model names and local paths. Review before sharing.', '',
    '## Summary', '',
    `- Nodes: ${analysis.stats.nodes}`, `- Links: ${analysis.stats.links}`, `- Node types: ${analysis.stats.nodeTypes}`,
    `- Model references: ${analysis.stats.models}`, `- Errors: ${analysis.stats.errors}`, `- Warnings: ${analysis.stats.warnings}`, '',
    '## Coverage notes', '', ...workflow.notices.map((notice) => `- ${md(notice)}`), '',
    '## Diagnostics', '',
    ...analysis.diagnostics.map((item) => `- **${item.severity.toUpperCase()} / ${md(item.code)}: ${md(item.title)}**\n  ${md(item.message)}${item.nodeIds.length ? ` (nodes: ${item.nodeIds.map(md).join(', ')})` : ''}`),
    ...(analysis.diagnostics.length ? [] : ['No findings from the supported static checks.']), '',
    '## Dependencies', '', '| Kind | Name | Nodes | Status | Evidence |', '| --- | --- | --- | --- | --- |',
    ...analysis.dependencies.map((item) => `| ${item.kind} | ${md(item.name)} | ${item.nodeIds.map(md).join(', ')} | ${item.status} | ${md(item.source)} |`), '',
  ];
  if (diff) lines.push('## Revision comparison', '', ...diff.notices.map((notice) => `- ${md(notice)}`), '',
    ...diff.changes.map((change) => `- **${change.kind}: ${md(change.subject)} / ${md(change.field)}**\n  Before: ${value(change.before)}\n  After: ${value(change.after)}`),
    ...(diff.changes.length && diff.comparable ? [] : [diff.comparable ? 'No semantic changes detected.' : 'These formats cannot be compared directly.']), '');
  lines.push('---', 'Generated locally by ComfyTrace. No file was uploaded.', '');
  return lines.join('\n');
}

export function createDependencyManifest(workflow: Workflow, analysis: Analysis): string {
  return JSON.stringify({
    schemaVersion: 1, generator: 'ComfyTrace', workflow: workflow.name, format: workflow.format,
    scope: 'Static references only; not a package lockfile or installation script.',
    dependencies: analysis.dependencies,
  }, null, 2);
}

export function downloadText(name: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) || 'comfytrace-export.txt';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
