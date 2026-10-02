export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type WorkflowFormat = 'ui' | 'api';
export type Severity = 'error' | 'warning' | 'info';

export interface WorkflowNode {
  id: string;
  type: string;
  title: string;
  mode: number;
  inputs: Record<string, JsonValue>;
  widgets: JsonValue;
  properties?: JsonValue;
  position?: [number, number];
  packageName?: string;
}

export interface WorkflowLink {
  id: string;
  source: string;
  target: string;
  sourceSlot: number;
  targetSlot: number | string;
  type?: JsonValue;
}

export interface Workflow {
  name: string;
  format: WorkflowFormat;
  version: string;
  nodes: WorkflowNode[];
  links: WorkflowLink[];
  raw: JsonValue;
  notices: string[];
  provenance?: string;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  title: string;
  message: string;
  nodeIds: string[];
}

export interface Dependency {
  kind: 'model' | 'node';
  name: string;
  nodeIds: string[];
  source: string;
  status: 'unknown' | 'available' | 'missing';
}

export interface Analysis {
  diagnostics: Diagnostic[];
  dependencies: Dependency[];
  layers: string[][];
  stats: { nodes: number; links: number; nodeTypes: number; models: number; errors: number; warnings: number };
}

export interface Difference {
  kind: 'added' | 'removed' | 'changed';
  nodeId?: string;
  subject: string;
  field: string;
  before?: JsonValue;
  after?: JsonValue;
}

export interface DiffResult {
  changes: Difference[];
  unchangedNodes: number;
  comparable: boolean;
  notices: string[];
}

export type NodeInventory = Record<string, unknown>;
