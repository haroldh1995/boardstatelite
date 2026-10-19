# Preflight and Demo Runbook

## Local verification

```bash
npm ci
npm run typecheck
npm run lint
npm run format
npm run demo:scenarios
npm test -- --maxWorkers=1
npm run build
npm run e2e -- --workers=1
```

`npm run demo:scenarios` uses the production domain and workflow services with
an isolated deterministic session. It writes the machine-readable report to
`output/demo-scenarios.json`, which is ignored by Git. Each result includes the
scenario id, fixture summary, actions, expected and actual state, errors, build
id, and commit id.

## Portrait recording setup

1. Build the production preview with `npm run build`.
2. Start `npm run preview -- --host 127.0.0.1 --port 4174`.
3. Use a clean portrait browser profile at `http://127.0.0.1:4174/`.
4. Capture the real app interactions covered by the demo scenarios; do not
   inject state through browser developer tools.
5. Keep the browser console, personal account data, and notifications outside
   the capture surface.
6. Stop the preview server and remove local recordings from the repository
   before committing production code.

The existing Playwright suite is the repeatable web capture and interaction
validation path. Native screen recording requires the corresponding simulator
or physical-device toolchain, which is not present in this repository.

## Release handoff

Review `docs/FINAL_PREFLIGHT_REPORT.md` and `docs/RELEASE_GATES.md` before
advertising or submitting a native build. Treat native build/signing,
permissions, privacy disclosures, and card/artwork rights as separate release
gates; browser test success does not close them.
