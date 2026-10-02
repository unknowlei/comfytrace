import { useEffect, useMemo, useRef, useState } from 'react';
import { Expand, Minus, Plus, Route } from 'lucide-react';
import type { Analysis, Workflow } from '../core/types';

interface GraphProps {
  workflow: Workflow;
  analysis: Analysis;
  selectedId: string;
  onSelect: (id: string) => void;
}

const NODE_WIDTH = 186;
const NODE_HEIGHT = 88;
const MAX_NODES = 160;

export function nodeCategory(type: string): string {
  if (/save|preview|output/i.test(type)) return 'OUTPUT';
  if (/sampl|scheduler|guider/i.test(type)) return 'SAMPLING';
  if (/text|clip|condition/i.test(type)) return 'CONDITIONING';
  if (/load|checkpoint|lora/i.test(type)) return 'RESOURCE';
  if (/latent|vae|image/i.test(type)) return 'IMAGE';
  return 'PROCESS';
}

export default function WorkflowGraph({ workflow, analysis, selectedId, onSelect }: GraphProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.9);
  const [size, setSize] = useState({ width: 600, height: 440 });
  const [fitted, setFitted] = useState(false);

  const layout = useMemo(() => {
    const ids = new Set(workflow.nodes.slice(0, MAX_NODES).map((node) => node.id));
    if (selectedId && !ids.has(selectedId)) {
      const last = [...ids].at(-1);
      if (last) ids.delete(last);
      ids.add(selectedId);
    }
    const nodes = workflow.nodes.filter((node) => ids.has(node.id));
    const existing = new Set(nodes.map((node) => node.id));
    const placed = new Set<string>();
    const layers = analysis.layers.map((layer) => layer.filter((id) => {
      if (!existing.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    })).filter((layer) => layer.length);
    const remaining = nodes.filter((node) => !placed.has(node.id)).map((node) => node.id);
    if (remaining.length) layers.push(remaining);
    const rows = Math.max(1, ...layers.map((layer) => layer.length));
    const positions = new Map<string, { x: number; y: number }>();
    layers.forEach((layer, column) => {
      layer.forEach((id, row) => positions.set(id, {
        x: 40 + column * 260,
        y: 60 + row * 124 + (rows - layer.length) * 62,
      }));
    });
    return {
      nodes,
      positions,
      width: Math.max(400, layers.length * 260 + 6),
      height: Math.max(300, rows * 124 + 84),
      links: workflow.links.filter((link) => positions.has(link.source) && positions.has(link.target)).slice(0, 900),
      order: layers.flat(),
    };
  }, [workflow, analysis.layers, selectedId]);

  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setFitted(false); setZoom(0.9); }, [workflow]);

  const fit = Math.max(0.25, Math.min(1, (size.width - 20) / layout.width, (size.height - 20) / layout.height));
  const scale = fitted ? fit : zoom;

  useEffect(() => {
    const node = layout.positions.get(selectedId);
    const target = viewport.current;
    if (!node || !target) return;
    target.scrollTo({
      left: Math.max(0, (node.x + NODE_WIDTH / 2) * scale - target.clientWidth / 2),
      top: Math.max(0, (node.y + NODE_HEIGHT / 2) * scale - target.clientHeight / 2),
      behavior: 'instant',
    });
  }, [selectedId, layout, scale]);

  const diagnosticNodes = useMemo(() => {
    const result = new Map<string, 'error' | 'warning' | 'info'>();
    analysis.diagnostics.forEach((diagnostic) => diagnostic.nodeIds.forEach((id) => {
      if (!result.has(id) || diagnostic.severity === 'error') result.set(id, diagnostic.severity);
    }));
    return result;
  }, [analysis.diagnostics]);

  const stepZoom = (amount: number) => {
    setZoom(Math.max(0.25, Math.min(1.6, scale + amount)));
    setFitted(false);
  };

  return <section className="graph-panel" aria-label="工作流图谱">
    <div className="graph-heading">
      <span className="section-label"><Route size={15} aria-hidden="true" /> WORKFLOW MAP</span>
      <span className="graph-flow">输入 <span aria-hidden="true">→</span> 输出</span>
    </div>
    <div className="graph-viewport" ref={viewport} tabIndex={0} aria-label="可滚动图谱，节点可用方向键选择" data-testid="graph-viewport">
      <div className="graph-space" style={{ width: Math.max(size.width, layout.width * scale), height: Math.max(size.height, layout.height * scale) }}>
        <div className="graph-stage" style={{ width: layout.width, height: layout.height, top: Math.max(0, (size.height - layout.height * scale) / 2), left: Math.max(0, (size.width - layout.width * scale) / 2), transform: `scale(${scale})` }}>
          <svg className="graph-connections" width={layout.width} height={layout.height} aria-hidden="true">
            <defs><marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="currentColor" /></marker></defs>
            {layout.links.map((link, index) => {
              const source = layout.positions.get(link.source)!;
              const target = layout.positions.get(link.target)!;
              const x1 = source.x + NODE_WIDTH;
              const y1 = source.y + NODE_HEIGHT / 2;
              const x2 = target.x - 4;
              const y2 = target.y + NODE_HEIGHT / 2;
              const bend = Math.max(34, Math.abs(x2 - x1) * 0.48);
              return <path key={`${link.id}-${index}`} className={link.source === selectedId || link.target === selectedId ? 'connection active' : 'connection'} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} markerEnd="url(#arrowhead)" />;
            })}
          </svg>
          {layout.nodes.map((node) => {
            const position = layout.positions.get(node.id)!;
            const severity = diagnosticNodes.get(node.id);
            return <button
              key={node.id}
              className={`graph-node ${selectedId === node.id ? 'is-selected' : ''} ${severity ? `has-${severity}` : ''}`}
              style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              aria-label={`选择节点 ${node.id} ${node.title}`}
              aria-pressed={selectedId === node.id}
              data-node-id={node.id}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                const index = layout.order.indexOf(node.id);
                let next: string | undefined;
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = layout.order[Math.min(index + 1, layout.order.length - 1)];
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = layout.order[Math.max(index - 1, 0)];
                if (event.key === 'Home') next = layout.order[0];
                if (event.key === 'End') next = layout.order.at(-1);
                if (next) {
                  event.preventDefault();
                  onSelect(next);
                  const buttons = viewport.current?.querySelectorAll<HTMLButtonElement>('[data-node-id]');
                  buttons?.forEach((button) => { if (button.dataset.nodeId === next) button.focus({ preventScroll: true }); });
                }
              }}
              title={`${node.title}\n${node.type}\nID: ${node.id}`}
            >
              <span className="node-port input" />
              <span className="node-topline"><span className="node-category">{nodeCategory(node.type)}</span><span className="node-id">#{node.id}</span></span>
              <strong>{node.title}</strong>
              <span className="node-type">{node.type}</span>
              <span className="node-port output" />
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="graph-footer">
      <span className="graph-legend"><i /> 数据连线<span className="legend-warning"><i /> 待检查</span><span className="pan-hint">可滚动浏览</span></span>
      <div className="zoom-controls">
        <button className="icon-button" onClick={() => stepZoom(-0.15)} disabled={scale <= 0.25} aria-label="缩小图谱"><Minus size={16} /></button>
        <output aria-label="缩放比例">{Math.round(scale * 100)}%</output>
        <button className="icon-button" onClick={() => stepZoom(0.15)} disabled={scale >= 1.6} aria-label="放大图谱"><Plus size={16} /></button>
        <button className="icon-button" onClick={() => setFitted(true)} aria-label="适应画布" title="适应画布"><Expand size={16} /></button>
      </div>
    </div>
    {(workflow.nodes.length > MAX_NODES || workflow.links.length > 900) && <p className="graph-limit">图谱最多显示 {MAX_NODES} 个节点、900 条可见连线；搜索可定位其余节点，分析和导出仍使用完整工作流。</p>}
  </section>;
}
