# Contributing

Use Node.js 22.12+ and `npm ci`. Before opening a pull request, run typecheck,
unit tests, production build and browser tests (see README). Changes to input
handling or diagnostics need a minimal fixture and a regression assertion.

## Design constraints

- Keep the shipped application usable offline as a single HTML file.
- Keep the analysis core independent from React, DOM, Node and network APIs.
- Do not infer installation state without an explicit environment snapshot.
- Preserve unknown workflow data and clearly state unsupported coverage.
- Treat imported files as data, never executable instructions or HTML.
- No user workflows, secrets, downloaded models or copyrighted outputs in fixtures.
- Prefer bounded iterative algorithms and actionable evidence in diagnostics.

Bug reports should include the input format, a minimal anonymized fixture,
expected behavior, actual behavior and browser/runtime versions.
