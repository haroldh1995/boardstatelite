# BoardState Lite Marketing Asset Manifest

## Verified deliverables

| Asset                           | Location                                                           | Notes                                                                   |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Continuous raw evidence         | `release-marketing/raw/page@731977029f27f77cbc5482576b31bac5.webm` | Unedited 390 x 844 browser recording of the isolated live test session. |
| Evidence MP4                    | `release-marketing/renders/evidence-live.mp4`                      | H.264 conversion of the raw recording for review.                       |
| Machine-readable feature report | `release-marketing/evidence/feature-test-results.json`             | Per-feature expected/actual/status/timestamp/build/commit.              |
| Human-readable feature report   | `release-marketing/evidence/feature-test-report.md`                | Live coverage and claim boundaries.                                     |
| Master advertisement            | `release-marketing/renders/boardstate-lite-master-16x9.mp4`        | 1920 x 1080, 70 seconds.                                                |
| Vertical social advertisement   | `release-marketing/renders/boardstate-lite-social-9x16.mp4`        | 1080 x 1920, 70 seconds.                                                |
| Social teaser                   | `release-marketing/renders/boardstate-lite-teaser-15s.mp4`         | 1920 x 1080, 15 seconds.                                                |
| Thumbnail/poster                | `release-marketing/renders/boardstate-lite-thumbnail.jpg`          | 1920 x 1080 JPEG frame from the rendered master.                        |
| Captions                        | `release-marketing/production/captions.srt`                        | Subtitle timing for the approved narration.                             |
| Narration source                | `release-marketing/production/generate-voiceover.ps1`              | Reproducible local Windows Speech generation script.                    |
| Render source                   | `release-marketing/production/render-ad.ps1`                       | Reproducible FFmpeg-based render source.                                |
| Capture source                  | `release-marketing/capture-live-demo.mjs`                          | Playwright capture and evidence runner.                                 |

## Source and rights notes

- Application footage is from the BoardState Lite production preview and is isolated from personal data.
- Card search and card imagery use the existing BoardState Lite Scryfall integration; application attribution remains in the app.
- No commercial music or third-party commercial soundtrack is bundled. The render uses locally generated narration and original UI interaction audio only.
- The creative does not claim Wizards of the Coast endorsement. BoardState Lite is presented as an unofficial physical Commander companion.
- Raw evidence and promotional renders are kept separate so the evidence remains reviewable without editorial changes.
