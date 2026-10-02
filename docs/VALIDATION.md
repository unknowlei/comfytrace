# Release validation

Validated on 2026-10-02, Asia/Hong_Kong.

## Local release candidate

- Node.js 22.19.0 on Windows; TypeScript strict check passed.
- **135 unit / regression / CLI tests passed** (46 core, 67 I/O, 22 independent review).
- **14 production browser tests passed**, using installed Microsoft Edge through
  Playwright and opening `dist/index.html` directly over `file://`.
- Axe WCAG 2 A/AA and WCAG 2.1 AA checks found zero violations in the tested
  desktop and 375px mobile states. This is not a comprehensive accessibility audit.
- Mobile document width stayed within the viewport; reduced-motion mode exercised.
- 2,000-node input exercised: graph rendering stayed at 160 visible nodes,
  diagnostics paginated at 100 per page, and node 1999 remained searchable/selectable.
- Real download events verified Markdown report and JSON manifest contents.
- PNG compressed-metadata import and drag/drop exercised in the browser.
- Initial application reload made no HTTP(S) requests and raised no JavaScript errors.
- npm's official registry audit returned **0 known vulnerabilities** at check time.
- Portable HTML size: **313,253 bytes**. No installation or server needed.

SHA-256 of the validated portable HTML:

```text
61ab5a878340fe9da64a4996fbff7679615a1f5119f2564ee4757ccf32bc070b
```

## Independent review improvements

Review was performed separately from the core implementation. Regressions cover
malformed inventory descriptions, compliant example fields, PNG provenance not
being mistaken for a warning, UI numeric-string slots, subgraph outer endpoints,
UI-only helpers excluded from backend inventories, PrimitiveNode configuration
changes, non-string link types, dangling-link differences and true SCC membership.

Browser review corrected misleading equality for incomparable formats, inaccessible
scroll regions, small default graph text and unbounded result rendering. The final
tests include those corrections rather than merely recording the initial failures.

## Reproduce

```powershell
$ErrorActionPreference = 'Stop'
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run package
```

CI runs typecheck, unit tests and build on both Ubuntu and Windows. Browser tests
run with Chromium on Ubuntu. The exact run status is visible in GitHub Actions;
this local record does not substitute for a completed CI run.

## Not covered by these results

No GPU job or ComfyUI runtime was executed. Nested subgraph internals, arbitrary
custom validation, model compatibility and image quality remain outside static
analysis. Safari and Firefox have not been exercised in this release validation.
