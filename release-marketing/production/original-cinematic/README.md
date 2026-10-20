# Original Cinematic Production

This is the original motion-graphics advertisement requested for BoardState Lite. The advertisement is generated from a self-contained canvas composition and captured with Playwright, then encoded with the repository's available FFmpeg installer.

## Reproduce

```powershell
node release-marketing/production/original-cinematic/capture-original-cinematic.mjs landscape
node release-marketing/production/original-cinematic/capture-original-cinematic.mjs vertical
node release-marketing/production/original-cinematic/capture-original-cinematic.mjs teaser
powershell -NoProfile -ExecutionPolicy Bypass -File release-marketing/production/original-cinematic/render-original-cinematic.ps1
```

Capture output is kept in `release-marketing/raw/original-cinematic/`. Rendered deliverables are kept in `release-marketing/renders/original-cinematic/`. The production is separate from the earlier live-evidence advertisement and does not reuse that footage as its visual foundation.
