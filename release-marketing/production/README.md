# BoardState Lite Live Test and Advertisement

This directory contains the reproducible capture and render workflow for the current release candidate.

## Capture

1. Build and start the production preview: `npm run build` then `npm run preview -- --host 127.0.0.1 --port 4174 --strictPort`.
2. Run `node release-marketing/capture-live-demo.mjs`.
3. The isolated Playwright context records authentic UI interactions into `release-marketing/raw/` and writes machine-readable evidence plus screenshots into `release-marketing/evidence/`.

The capture uses a fresh browser context and the app's reference battlefield fixture. It does not touch a personal browser profile or production account.

## Render

On Windows, `generate-voiceover.ps1` uses the installed Windows Speech voice and writes `release-marketing/narration.wav`. `render-ad.ps1` uses `FFMPEG` when set, otherwise the local validation binary at `node_modules/ffmpeg-win32.exe`, and writes the 16:9 master, 9:16 social cut, 15-second teaser, and thumbnail to `release-marketing/renders/`.

The editable production source is the PowerShell render script, the capture script, the captions, and this procedure. Raw evidence is kept separate from edited promotional renders.

## Integrity

The evidence report records each live scenario's expected behavior, observed result, timestamp, build identifier, and commit. The advertisement only uses verified product claims and identifies BoardState Lite as an unofficial companion for physical Commander play.

Card information and imagery shown by the app are sourced through the application's existing Scryfall integration. Scryfall attribution remains in the application. No commercial music is bundled; the narration is generated locally from the approved script and the cuts use original application interaction audio only.
