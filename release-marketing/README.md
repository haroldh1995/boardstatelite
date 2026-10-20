# BoardState Lite Marketing Production

This directory contains authentic live-test evidence and the revision-02 commercial edit.

## Verified evidence

Run the isolated Chromium capture against the local app with:

```powershell
$env:PLAYWRIGHT_REUSE_SERVER='1'
npx playwright test tests/e2e/marketing-capture-pass.spec.ts --project=chromium --workers=1 --reporter=line
```

The passing raw recordings are under `raw/verified-marketing/`. The target/sacrifice, Offline, Echo, and ARGUS attempts remain separate under `evidence/final-ad/` and are not advertised.

## Render

Set `FFMPEG` to a working FFmpeg executable and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File release-marketing/production/render-final-ad.ps1
```

The script produces independently composed landscape and portrait review cuts from the verified portrait captures. It uses an original generated instrumental bed and no placeholder AI narration. Use `production/final-narration-script.md` and `production/captions-revision-02.srt` / `.vtt` for a human-recorded final narration mix.

## Deliverables

Final review renders are under `renders/final-revision/`. Editorial decisions are documented in `production/editorial-audit-revision-02.md`, feature provenance in `evidence/feature-evidence-map-revision-02.md`, and visual/render verification in `evidence/final-quality-control-revision-02.md`.

The original prior advertisement is preserved under `archive/previous-ad/`.
