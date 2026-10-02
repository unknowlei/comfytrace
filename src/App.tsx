import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleHelp, FileJson, FileUp, GitCompareArrows, Layers3, ListFilter, LockKeyhole, Package, ScanLine, Search, ShieldCheck, SlidersHorizontal, Workflow as WorkflowIcon, X } from 'lucide-react';
import { parseWorkflow } from './core/parse';
import { analyzeWorkflow } from './core/analyze';
import { diffWorkflows } from './core/diff';
import type { Dependency, JsonValue, NodeInventory, Severity, Workflow, WorkflowNode } from './core/types';
import { readWorkflowFile, readInventoryFile } from './io/import';
import { downloadText, createMarkdownReport, createDependencyManifest } from './io/export';
import { demoWorkflow, demoRevision, brokenWorkflow } from './data/demo';
import WorkflowGraph from './components/WorkflowGraph';
import PaginatedItems from './components/PaginatedItems';
import './styles.css';

type Section = 'diagnostics' | 'dependencies' | 'diff';
const severityLabels: Record<Severity, string> = { error: '错误', warning: '建议检查', info: '提示' };
const statusLabels: Record<Dependency['status'], string> = { unknown: '未核实', available: '清单中存在', missing: '清单中缺失' };
const changeLabels = { added: '新增', removed: '删除', changed: '修改' };

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function suggestedNode(workflow: Workflow): string {
  return workflow.nodes.find((node) => /sampler/i.test(node.type))?.id ?? workflow.nodes[0]?.id ?? '';
}

function Inspector({ node, workflow, onSelect }: { node: WorkflowNode | undefined; workflow: Workflow; onSelect: (id: string) => void }) {
  const incoming = node ? workflow.links.filter((link) => link.target === node.id) : [];
  const outgoing = node ? workflow.links.filter((link) => link.source === node.id) : [];
  return <aside className="inspector panel" aria-label="节点检查器">
    <div className="panel-heading"><span className="section-label"><SlidersHorizontal size={15} aria-hidden="true" /> INSPECTOR</span><span className="muted small">节点证据</span></div>
    {node ? <div className="inspector-content" data-testid="inspector" tabIndex={0} aria-label="可滚动的节点参数证据">
      <div className="inspector-id">NODE <strong>#{node.id}</strong></div>
      <h2>{node.title}</h2>
      <code className="type-label">{node.type}</code>
      <div className="connection-summary"><span><b>{incoming.length}</b> 入边</span><span><b>{outgoing.length}</b> 出边</span><span><b>{node.mode}</b> mode</span></div>
      {node.packageName && <div className="parameter-block"><h3>声明的节点包</h3><code>{node.packageName}</code></div>}
      <div className="parameter-block"><h3>输入参数 <span>{Object.keys(node.inputs).length}</span></h3>
        {Object.entries(node.inputs).length ? <dl className="parameter-list">{Object.entries(node.inputs).map(([key, value]) => {
          const connection = incoming.find((link) => link.targetSlot === key || (value && typeof value === 'object' && !Array.isArray(value) && String(value.link) === link.id));
          return <div key={key}><dt>{key}</dt><dd>{connection ? <button className="input-connection" onClick={() => onSelect(connection.source)} title={`定位输入来源节点 ${connection.source}`}><span>#{connection.source}</span><ArrowRight size={11} aria-hidden="true" /><span>slot {connection.sourceSlot}</span></button> : <pre>{formatValue(value)}</pre>}</dd></div>;
        })}</dl> : <p className="muted small">此节点没有记录输入参数。</p>}
      </div>
      {node.widgets !== null && <div className="parameter-block"><h3>Widget 原始值</h3><pre className="widget-values" tabIndex={0} aria-label="Widget 原始值，可滚动">{formatValue(node.widgets)}</pre><p className="muted caption">数组字段保留原顺序；自定义节点的参数名需要对应节点定义。</p></div>}
    </div> : <div className="empty-state"><ScanLine size={24} /><p>选择一个节点查看参数与连接。</p></div>}
  </aside>;
}

export default function App() {
  const [workflow, setWorkflow] = useState(() => parseWorkflow(demoWorkflow, '光影练习 · 文生图'));
  const [selectedId, setSelectedId] = useState(() => suggestedNode(workflow));
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<Section>('diagnostics');
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [inventory, setInventory] = useState<NodeInventory>();
  const [inventoryName, setInventoryName] = useState('');
  const [comparison, setComparison] = useState<Workflow>();
  const [status, setStatus] = useState('内置样例已就绪。所有解析在当前设备完成。');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sample, setSample] = useState('demo');
  const fileInput = useRef<HTMLInputElement>(null);
  const inventoryInput = useRef<HTMLInputElement>(null);
  const comparisonInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const analysis = useMemo(() => analyzeWorkflow(workflow, inventory), [workflow, inventory]);
  const differences = useMemo(() => comparison ? diffWorkflows(workflow, comparison) : undefined, [workflow, comparison]);
  const selected = workflow.nodes.find((node) => node.id === selectedId);
  const matchingNodes = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return workflow.nodes.filter((node) => `${node.id} ${node.type} ${node.title}`.toLocaleLowerCase().includes(search));
  }, [workflow, query]);
  const diagnostics = analysis.diagnostics.filter((item) => severity === 'all' || item.severity === severity);
  const nodeDependencies = analysis.dependencies.filter((item) => item.kind === 'node');
  const modelDependencies = analysis.dependencies.filter((item) => item.kind === 'model');

  const activateWorkflow = (next: Workflow, sampleName: string) => {
    setWorkflow(next);
    setSelectedId(suggestedNode(next));
    setQuery('');
    setComparison(undefined);
    setSample(sampleName);
    setError('');
    setStatus(`已载入 ${next.name}，共 ${next.nodes.length} 个节点。`);
  };

  const selectNode = (id: string) => {
    if (!workflow.nodes.some((node) => node.id === id)) {
      setStatus(`节点 ${id} 不存在于当前工作流，详见诊断证据。`);
      return;
    }
    setSelectedId(id);
    setStatus(`已定位节点 ${id}。右侧检查器显示该节点的参数。`);
  };

  const loadFile = async (file: File, kind: 'workflow' | 'inventory' | 'comparison') => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setStatus(`正在读取 ${file.name}…`);
    try {
      if (kind === 'inventory') {
        const next = await readInventoryFile(file);
        if (currentRequest !== requestId.current) return;
        setInventory(next);
        setInventoryName(file.name);
        setStatus(`已导入节点定义清单 ${file.name}。`);
      } else {
        const next = await readWorkflowFile(file);
        if (currentRequest !== requestId.current) return;
        if (kind === 'workflow') activateWorkflow(next, 'file');
        else { setComparison(next); setSection('diff'); setStatus(`已对比：${workflow.name} → ${next.name}。`); }
      }
    } catch (cause) {
      if (currentRequest !== requestId.current) return;
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`无法读取 ${file.name}：${detail}`);
      setStatus('文件导入失败。当前工作流保持不变，请检查文件格式后重试。');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>, kind: 'workflow' | 'inventory' | 'comparison') => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file, kind);
    event.target.value = '';
  };

  const loadSample = (value: string) => {
    requestId.current++;
    setLoading(false);
    activateWorkflow(parseWorkflow(value === 'broken' ? brokenWorkflow : demoWorkflow, value === 'broken' ? '诊断练习 · 待修复工作流' : '光影练习 · 文生图'), value);
  };

  const exportReport = () => {
    downloadText('comfytrace-report.md', createMarkdownReport(workflow, analysis, differences), 'text/markdown;charset=utf-8');
    setStatus('Markdown 检查报告已生成下载。分享前请检查其中的提示词与文件名。');
  };

  const exportDependencies = () => {
    downloadText('comfytrace-dependencies.json', createDependencyManifest(workflow, analysis), 'application/json');
    setStatus('依赖清单 JSON 已生成下载。');
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = event.dataTransfer.files;
    if (files.length !== 1) { setError('每次请拖入一个 JSON 或 PNG 工作流文件。'); return; }
    void loadFile(files[0], 'workflow');
  };

  const renderDependency = (dependency: Dependency, index: number) => <div className="dependency-row" key={`${dependency.kind}-${dependency.name}-${index}`}>
    <div className="dependency-icon"><Package size={17} aria-hidden="true" /></div>
    <div className="dependency-name"><strong>{dependency.name}</strong><span>{dependency.source}</span></div>
    <div className="dependency-nodes">{dependency.nodeIds.slice(0, 5).map((id) => <button key={id} className="node-link" onClick={() => selectNode(id)} title={`定位节点 ${id}`}>#{id}</button>)}{dependency.nodeIds.length > 5 && <span className="muted small">+{dependency.nodeIds.length - 5}</span>}</div>
    <span className={`badge dependency-status ${dependency.status}`}>{statusLabels[dependency.status]}</span>
  </div>;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#workspace" aria-label="ComfyTrace 工作区"><span className="brand-mark"><WorkflowIcon size={23} strokeWidth={1.8} aria-hidden="true" /></span><span><strong>ComfyTrace<span className="brand-period">.</span></strong><small>OFFLINE WORKFLOW INSPECTOR</small></span></a>
      <div className="topbar-actions"><span className="privacy-indicator"><LockKeyhole size={14} aria-hidden="true" /> 本地处理</span><button className="button quiet export-button" onClick={exportReport} aria-label="导出报告" title="导出报告"><ArrowDownToLine size={16} aria-hidden="true" /><span>导出报告</span></button><button className="button primary" onClick={() => fileInput.current?.click()} disabled={loading}><FileUp size={16} aria-hidden="true" />{loading ? '正在读取…' : '导入工作流'}</button></div>
    </header>

    <main id="workspace" className={`workspace ${dragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={onDrop}>
      <input ref={fileInput} type="file" accept=".json,.png,application/json,image/png" onChange={(event) => onFileChange(event, 'workflow')} className="hidden-input" aria-label="导入工作流文件" data-testid="workflow-file-input" />
      <input ref={inventoryInput} type="file" accept=".json,application/json" onChange={(event) => onFileChange(event, 'inventory')} className="hidden-input" aria-label="导入 object_info 文件" data-testid="inventory-file-input" />
      <input ref={comparisonInput} type="file" accept=".json,.png,application/json,image/png" onChange={(event) => onFileChange(event, 'comparison')} className="hidden-input" aria-label="导入对比工作流" data-testid="comparison-file-input" />
      {dragging && <div className="drop-overlay"><FileUp size={38} /><strong>放下文件，展开工作流</strong><span>ComfyUI JSON / 含工作流元数据的 PNG</span></div>}

      <section className="workspace-heading">
        <div><div className="eyebrow">看清连接，再开始创作 <span className="eyebrow-line" /></div><h1>{workflow.name}</h1><div className="workflow-meta"><span className="format-tag">{workflow.format === 'api' ? 'API PROMPT' : `COMFYUI ${workflow.version || 'WORKFLOW'}`}</span><span>结构 · 依赖 · 版本变化</span></div></div>
        <div className="sample-control"><label htmlFor="sample-select">探索工作流</label><select id="sample-select" value={sample} onChange={(event) => loadSample(event.target.value)}><option value="demo">内置样例 / 文生图</option><option value="broken">诊断样例 / 待修复</option>{sample === 'file' && <option value="file">已导入的工作流</option>}</select><span>也可拖入 JSON 或 PNG</span></div>
      </section>

      {error && <div className="error-banner" role="alert"><AlertCircle size={18} aria-hidden="true" /><p>{error}</p><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={17} /></button></div>}

      <section className="summary-strip" aria-label="工作流概览">
        <div><Layers3 size={17} aria-hidden="true" /><strong>{analysis.stats.nodes}</strong><span>节点</span></div>
        <div><WorkflowIcon size={17} aria-hidden="true" /><strong>{analysis.stats.links}</strong><span>连接</span></div>
        <div><Package size={17} aria-hidden="true" /><strong>{analysis.stats.models}</strong><span>模型引用</span></div>
        <button className={analysis.stats.errors ? 'summary-error' : 'summary-check'} onClick={() => { setSection('diagnostics'); setSeverity('all'); }}><ShieldCheck size={18} aria-hidden="true" /><strong>{analysis.stats.errors ? `${analysis.stats.errors} 项错误` : '结构检查已完成'}</strong><span>{analysis.stats.warnings} 项建议</span><ChevronRight size={15} aria-hidden="true" /></button>
      </section>

      <div className="inspection-desk">
        <aside className="node-sidebar panel" aria-label="节点索引">
          <div className="panel-heading"><span className="section-label">NODES</span><span className="count-label">{workflow.nodes.length}</span></div>
          <label className="search-field"><Search size={16} aria-hidden="true" /><input type="search" placeholder="搜索节点或 ID" aria-label="搜索节点或 ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="node-list">{matchingNodes.slice(0, 300).map((node) => <button key={node.id} className={`node-list-item ${selectedId === node.id ? 'is-selected' : ''}`} onClick={() => selectNode(node.id)} aria-pressed={selectedId === node.id}><span className="list-node-id" title={node.id}>{node.id}</span><span><strong>{node.title}</strong><small>{node.type}</small></span>{selectedId === node.id && <ChevronRight size={14} aria-hidden="true" />}</button>)}{!matchingNodes.length && <p className="empty-search">没有匹配节点。试试节点类型或 ID。</p>}{matchingNodes.length > 300 && <p className="empty-search">显示前 300 项。缩小搜索范围以定位其余节点。</p>}</div>
          <div className="sidebar-footer"><span className="status-dot" />{matchingNodes.length} 个匹配节点</div>
        </aside>
        <WorkflowGraph workflow={workflow} analysis={analysis} selectedId={selectedId} onSelect={selectNode} />
        <Inspector node={selected} workflow={workflow} onSelect={selectNode} />
      </div>

      <section className="evidence-panel panel" aria-label="分析结果">
        <nav className="evidence-nav" aria-label="分析视图"><button className={section === 'diagnostics' ? 'active' : ''} onClick={() => setSection('diagnostics')} aria-pressed={section === 'diagnostics'}><ListFilter size={17} aria-hidden="true" />诊断<span>{analysis.diagnostics.length}</span></button><button className={section === 'dependencies' ? 'active' : ''} onClick={() => setSection('dependencies')} aria-pressed={section === 'dependencies'}><Package size={17} aria-hidden="true" />依赖清单<span>{analysis.dependencies.length}</span></button><button className={section === 'diff' ? 'active' : ''} onClick={() => setSection('diff')} aria-pressed={section === 'diff'}><GitCompareArrows size={17} aria-hidden="true" />版本对比{differences?.comparable && <span>{differences.changes.length}</span>}</button><span className="evidence-caption">FOLLOW THE EVIDENCE</span></nav>

        {section === 'diagnostics' && <div className="evidence-content">
          <div className="section-toolbar"><p>从结构问题到创作前检查，点击节点编号查看证据。</p><label className="inline-select">筛选<select value={severity} aria-label="筛选诊断级别" onChange={(event) => setSeverity(event.target.value as 'all' | Severity)}><option value="all">全部级别</option><option value="error">错误</option><option value="warning">建议检查</option><option value="info">提示</option></select></label></div>
          <div className="diagnostic-list" tabIndex={0} aria-label="可滚动的诊断结果">
            <PaginatedItems items={diagnostics} label="诊断" key={severity}>{(items) => items.map((diagnostic, index) => <article key={`${diagnostic.code}-${index}`} className={`diagnostic-row ${diagnostic.severity}`}>
              <div className="diagnostic-symbol"><AlertCircle size={18} aria-hidden="true" /></div>
              <div className="diagnostic-body">
                <div className="diagnostic-title"><h3>{diagnostic.title}</h3><span className={`badge ${diagnostic.severity}`}>{severityLabels[diagnostic.severity]}</span><code>{diagnostic.code}</code></div>
                <p>{diagnostic.message}</p>
                <div className="diagnostic-nodes">{diagnostic.nodeIds.slice(0, 20).map((id) => <button className="node-link" key={id} onClick={() => selectNode(id)}>节点 #{id}<ArrowRight size={12} aria-hidden="true" /></button>)}{diagnostic.nodeIds.length > 20 && <span className="muted small">另 {diagnostic.nodeIds.length - 20} 个节点，详见导出报告</span>}</div>
              </div>
            </article>)}</PaginatedItems>
            {!diagnostics.length && <div className="empty-state success"><Check size={25} aria-hidden="true" /><div><h3>{severity === 'all' ? '当前检查项未发现问题' : '此级别没有诊断结果'}</h3><p>运行结果仍取决于 ComfyUI 环境、模型文件与节点实现。</p></div></div>}
          </div>
        </div>}

        {section === 'dependencies' && <div className="evidence-content">
          <div className="section-toolbar dependency-toolbar"><p>节点可用性以导入的 <code>object_info</code> 为依据；模型引用需在运行环境确认。</p><div className="toolbar-actions"><button className="button quiet" onClick={() => inventoryInput.current?.click()} disabled={loading}><FileUp size={15} aria-hidden="true" />导入节点定义</button><button className="button quiet" onClick={exportDependencies}><ArrowDownToLine size={15} aria-hidden="true" />导出清单</button></div></div>
          <div className="inventory-note"><FileJson size={16} aria-hidden="true" />{inventoryName ? <><span>节点定义：<strong>{inventoryName}</strong> · {Object.keys(inventory ?? {}).length} 个类型</span><button className="text-button" onClick={() => { setInventory(undefined); setInventoryName(''); setStatus('已清除节点定义清单，依赖状态恢复为未核实。'); }}>清除</button></> : <span>尚未导入环境清单。可从 ComfyUI 的 <code>/object_info</code> 接口保存 JSON 后导入。</span>}</div>
          <div className="dependencies-list" tabIndex={0} aria-label="可滚动的依赖清单">
            <h3 className="dependency-group-title">节点类型 <span>{nodeDependencies.length}</span></h3><PaginatedItems items={nodeDependencies} label="节点类型">{(items) => items.map(renderDependency)}</PaginatedItems>
            <h3 className="dependency-group-title">模型引用 <span>{modelDependencies.length}</span></h3><PaginatedItems items={modelDependencies} label="模型引用">{(items) => items.map(renderDependency)}</PaginatedItems>
            {!modelDependencies.length && <p className="muted small">没有识别到模型文件引用。自定义节点可能通过其他字段加载模型。</p>}
          </div>
        </div>}

        {section === 'diff' && <div className="evidence-content">
          <div className="section-toolbar"><p>按节点 ID 比较内容，忽略画布移动。适用于同一工作流的修订。</p><div className="toolbar-actions"><button className="button quiet" onClick={() => { setComparison(parseWorkflow(demoRevision, '光影练习 · 修订版')); setStatus('已载入内置修订版，比较方向为当前工作流 → 修订版。'); }}>对比样例修订</button><button className="button primary" onClick={() => comparisonInput.current?.click()} disabled={loading}><FileUp size={15} aria-hidden="true" />导入对比版本</button></div></div>
          {comparison && differences ? <>
            <div className="diff-direction"><span><small>BEFORE / 当前</small><strong>{workflow.name}</strong></span><ArrowRight size={22} aria-hidden="true" /><span><small>AFTER / 对比</small><strong>{comparison.name}</strong></span><b>{differences.comparable ? `${differences.changes.length} 项变化` : '无法直接比较'}</b></div>
            {differences.notices.map((notice, index) => <p className="diff-notice" key={index}><AlertCircle size={15} aria-hidden="true" />{notice}</p>)}
            <div className="diff-list" tabIndex={0} aria-label="可滚动的版本差异">
              <PaginatedItems items={differences.changes} label="版本差异">{(items) => items.map((change, index) => <article className="diff-row" key={index}>
                <div className="diff-row-heading"><span className={`badge ${change.kind}`}>{changeLabels[change.kind]}</span><strong>{change.subject}</strong><code>{change.field}</code>{change.nodeId && <button className="node-link" onClick={() => selectNode(change.nodeId!)}>#{change.nodeId}</button>}</div>
                <div className="diff-values"><div><span>BEFORE</span><pre tabIndex={0} aria-label={`${change.subject} ${change.field} 修改前`}>{formatValue(change.before)}</pre></div><div><span>AFTER</span><pre tabIndex={0} aria-label={`${change.subject} ${change.field} 修改后`}>{formatValue(change.after)}</pre></div></div>
              </article>)}</PaginatedItems>
              {!differences.comparable ? <div className="empty-state"><AlertCircle size={25} aria-hidden="true" /><p>两份工作流的格式无法直接进行语义比较。请导入相同格式的修订版本。</p></div> : !differences.changes.length && <div className="empty-state success"><Check size={25} aria-hidden="true" /><p>未发现语义变化。{differences.unchangedNodes} 个节点保持一致。</p></div>}
            </div>
          </> : <div className="diff-empty"><div className="diff-illustration"><span><WorkflowIcon size={25} /></span><GitCompareArrows size={22} /><span><WorkflowIcon size={25} /></span></div><h3>提示词变了，还是采样参数变了？</h3><p>导入另一个版本，逐项查看新增、删除与修改。<br />也可以先对比内置样例修订。</p></div>}
        </div>}
      </section>

      <details className="help-panel"><summary><CircleHelp size={16} aria-hidden="true" />使用说明与检查范围<ChevronRight size={15} aria-hidden="true" /></summary><div className="help-content"><div><h3>支持的输入</h3><p>ComfyUI UI 工作流（tuple / object links）、API prompt，以及带 workflow 或 prompt 文本元数据的 PNG。使用顶部按钮或拖放文件导入。</p></div><div><h3>检查结果如何理解</h3><p>错误指出结构问题，建议包含启发式判断。自定义节点行为、模型兼容性和实际运行结果需要在 ComfyUI 中确认。版本比较以节点 ID 为基础。</p></div><div><h3>文件与隐私</h3><p>文件只在当前页面内存中处理，无需账号或网络。刷新页面会清空导入状态。报告包含工作流参数与提示词，分享前请审阅。</p></div></div></details>

      <footer className="footer"><span className="status-message" role="status" aria-live="polite" aria-atomic="true"><span className={`status-dot ${loading ? 'busy' : ''}`} />{status}</span><span className="footer-brand">ComfyTrace <span>/</span> LOCAL FIRST</span></footer>
    </main>
  </div>;
}
