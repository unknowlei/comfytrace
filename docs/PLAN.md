# ComfyTrace implementation plan

## Product

A local-first inspection desk for ComfyUI creators. Import UI workflows,
API prompts, or PNG metadata; inspect the graph, find structural problems,
inventory dependencies, compare revisions, and export a portable report.
No GPU, account, server, telemetry, or paid API is needed to use it.

## Acceptance criteria

- Standalone, offline HTML deliverable with a useful synthetic demo.
- UI 0.4 tuple links and UI 1.0 object links, plus API prompt imports.
- Bounded and defensive PNG text metadata parsing.
- Diagnostics distinguish definite graph errors from heuristic advice.
- Dependency inventory never claims an unverified dependency is installed.
- Semantic diff ignores canvas movement; changes retain before/after evidence.
- Accessible responsive interface, searchable nodes and selectable graph.
- Pure TypeScript core usable independently from the React interface.
- Unit and browser tests, production build, independent review and fixes.
- English/Chinese README, architecture, examples, CI, license, portfolio notes.
- Original examples only; no existing private workflows or credentials bundled.

## Implementation sequence

1. Freeze contracts and synthetic examples.
2. Build normalized parser, diagnostic graph engine, and semantic diff.
3. Build offline import/export boundary and polished visual inspection UI.
4. Exercise malformed input, graph edge cases, PNG import, exports, and UI.
5. Independently audit correctness, privacy, and usability; fix findings.
6. Package standalone HTML and source, record evidence and limitations.

## Design direction

Use a technical drawing desk, not a marketing landing page: a pale blue-gray
canvas, white instrument panels, deep ink typography, cobalt connections, and
amber diagnostic markers. The signature is a readable node-routing canvas with
an adjacent evidence inspector. Palette: paper #F3F6FA, surface #FFFFFF,
ink #18253B, secondary #53637B, cobalt #315DDD, amber #AC610B.
Use locally available system sans (Segoe UI / Microsoft YaHei) and system mono
(Cascadia Code / Consolas); no remote fonts. Generous canvas, compact controls,
16px body text, visible keyboard focus, reduced motion and mobile stacking.

## Boundaries

This is an offline inspector, not a ComfyUI execution engine. Installation
availability requires a user-supplied object_info inventory. Node-ID-based diff
compares revisions of the same graph, not arbitrarily renumbered graphs.
Subgraph internals and custom node runtime behavior must be reported as limits
unless explicitly parsed. Reports can contain prompts and should be reviewed
before sharing. No claim of earnings or traction without actual evidence.
