# Architecture

## Data flow

```text
File / CLI bytes
  -> bounded file reader
  -> JSON or PNG text metadata extraction
  -> validated normalized workflow + retained source
  -> graph analysis / dependency evidence / semantic diff
  -> React inspection desk OR CLI JSON/Markdown
```

The pure `src/core` layer has no DOM, network or filesystem dependencies.
The browser import boundary lives in `src/io`; the CLI reuses byte import and
report generation. React renders all imported strings as text, never raw HTML.

## Key decisions

### Normalize syntax, preserve evidence

UI workflows store links separately and widget arrays positionally. API prompts
store named input values and references inline. The parser preserves the original
JSON for format-specific checks and builds a common graph for analysis. Unknown
widget indexes are not assigned fabricated parameter names. The `raw` value is
retained by reference; core operations do not mutate it, and callers should treat
the returned source and parameter values as read-only.

API references require the shape `[string, number]`, with a nonnegative integer
output slot. Numeric pairs remain constants, as do arrays inside `__value__`
wrappers. UI slot indices also accept digit-only strings. Top-level subgraph
instances become outer graph nodes, but `definitions.subgraphs` internals are
not traversed. Internal dependencies, floating links and subgraph execution
remain outside the coverage boundary.

### Distinguish static evidence from environment knowledge

A node name alone does not prove a plugin is missing. Availability is unknown
until a user supplies an `/object_info` snapshot. Available/missing means present
or absent in that snapshot, not a current installation probe. UI-only `Note`,
`MarkdownNote`, `Reroute` and `PrimitiveNode`, and recognized embedded subgraph
types, are excluded from backend dependency lookup.

Model references come from an explicit known-loader field/index map and declared
`properties.models` metadata, never from arbitrary prompt strings. Extraction is
not exhaustive for custom loaders; model availability always remains unknown.
Output recognition uses a limited known-type set and explicit `output_node: true`
inventory evidence. A missing recognized output is a warning, not proof that
execution is impossible. A successful static check does not promise execution.
Port checks cover declared slot bounds and link-reference consistency; they do
not implement ComfyUI's required-input validation, type compatibility or custom
node validation hooks.

### Compare revisions without canvas noise

Node IDs are the identity boundary. Comparison includes `type`, `mode`, widgets,
normalized inputs/connections and all UI `properties`. Properties are compared
conservatively: they can hold real execution configuration, such as PrimitiveNode
replacement settings, as well as package versions and other metadata. A property
change is evidence of a configuration change, not proof of changed output.

Top-level position, size, viewport, color and title fields are ignored, as are
connection IDs when references remain consistent. An identically named field
inside `properties` is still compared. Broken input declarations and links to
missing target nodes retain their own difference evidence. Subgraph internals
are not compared. Different formats return `comparable: false`; renumbering is
reported as removal/addition rather than guessed through graph isomorphism.

### Graph algorithms and cost

Let `V` be the outer node count and `E` the stored connection count. Valid endpoints
populate forward/reverse adjacency sets; duplicate target-slot occupancy is
checked separately so that collapsing parallel adjacency edges loses no such
diagnostic evidence.

- **Cycles:** iterative Kosaraju traverses the graph and its reverse to identify
  strongly connected components. Multi-node components and self-loops are cycles;
  downstream nodes are not incorrectly labeled as cycle members. Traversal takes
  `O(V + E)` time and space; sorting member IDs for diagnostic presentation adds
  `O(sum(c log c))` comparisons across cycle components of size `c`.
- **Layers:** Kahn's indegree algorithm emits zero-indegree frontiers in
  `O(V + E)` time with `O(V + E)` graph storage. Nodes blocked by cycles are not
  assigned a topological layer. These layers describe stored links, not a ComfyUI
  execution schedule; mute/bypass and dynamic node behavior are not simulated.
- **Diff:** node/link indexes are built in expected `O(V + E)` time. Each node's
  incoming connections are sorted, costing `O(sum(d log d))` comparisons for
  incoming degree `d`; orphan-target links are sorted separately. Canonical JSON
  also sorts object keys, and current link comparators serialize their records.
  Serialization size and string-comparison costs therefore matter: the complete
  diff is not claimed to run in linear time.

These bounds apply to the named algorithms, not the whole import/report pipeline.
UI port-reference checks currently scan declared output-link lists, and dependency
node-ID deduplication scans existing lists; their worst-case costs can be quadratic
in a high-fan-out port or heavily shared dependency. Input limits bound that work;
the project does not claim a measured throughput or latency guarantee.

### Offline means the delivered artifact works offline

Vite bundles React, Lucide icons, CSS and application code into one HTML file.
The page uses system fonts, no backend, no localStorage and no service worker.
Browser tests load the production `file://` artifact with external network
requests monitored. The production build sets CSP `connect-src 'none'`; the
development configuration permits the local origin and localhost WebSocket
connection needed by the development server. Release behavior makes no network
calls.

### Bound untrusted input

- File size is checked before browser reads and before CLI reads.
- PNG chunks are length-bounded, CRC checked and metadata output is budgeted.
- Deflate is streamed with cancellation on expanded-size overflow.
- Duplicate workflow metadata is rejected to avoid ambiguous precedence.
- The parser permits at most 2,000 outer nodes (including subgraph instances),
  10,000 connections, 64 nesting levels, 250,000 JSON values, and a combined
  key/string budget of 16 * 1024 * 1024 UTF-16 code units. These core limits are
  separate from the stricter 8 MiB JSON file boundary.
- Iterative JSON validation rejects cycles, accessors, sparse arrays, exotic
  object prototypes, non-finite numbers and reserved pollution-related keys.
  Repeated acyclic object references are accepted for direct programmatic calls.
- Maps / own-property checks protect arbitrary imported identifiers.
- Markdown syntax and HTML characters are escaped in reports.
- CLI output uses exclusive creation, never overwriting a user's existing file.

## Testing strategy

Unit fixtures isolate parser formats, graph edges, malformed inputs, imports and
exports. Browser tests exercise the built single-file artifact, input controls,
real downloads, mobile layout and accessibility. Synthetic examples contain no
user content and are reproducible with `npm run examples`.

## Compatibility references

Implementations were checked against primary ComfyUI sources:

- [UI workflow 0.4 schema](https://docs.comfy.org/specs/workflow_json_0.4)
- [UI workflow 1.0 schema](https://docs.comfy.org/specs/workflow_json)
- [Current frontend schema and subgraph extensions](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/platform/workflow/validation/schemas/workflowSchema.ts)
- [Official API example](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/basic_api_example.py)
- [API link classification](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/graph_utils.py)
- [PNG metadata reader](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/scripts/metadata/png.ts)
- [Image/APNG metadata writer](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_ui.py)
- [Node definition format](https://docs.comfy.org/specs/nodedef_json)

Build tools: [Vite](https://vite.dev/guide/),
[vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile),
[Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/).
