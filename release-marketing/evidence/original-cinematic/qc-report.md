# Original Cinematic Quality-Control Report

## Scope

This report covers the original canvas-based commercial renders in `release-marketing/renders/original-cinematic/`. The render is a conceptual advertisement, separate from the unedited live feature evidence.

## Automated checks

- Source HTML renders at 1920x1080, 1080x1920, and 1080x1920 teaser canvases.
- MP4 outputs are encoded H.264 with yuv420p and AAC audio.
- Poster is extracted from the landscape master.
- Output durations and decode checks are recorded after rendering.
- Captions are supplied as both SRT and VTT.

Verified output probes:

- `boardstate-lite-original-cinematic-master-16x9.mp4`: 1920x1080, 16:9, 75.02 seconds, H.264/AAC at 48 kHz.
- `boardstate-lite-original-cinematic-social-9x16.mp4`: 1080x1920, 9:16, 75.02 seconds, H.264/AAC at 48 kHz.
- `boardstate-lite-original-cinematic-teaser-15s.mp4`: 1080x1920, 9:16, 15.01 seconds, H.264/AAC at 48 kHz.
- All three files decoded to null successfully with the configured FFmpeg binary.

## Visual checks

- Original visual treatment uses a stable deep navy, blue-violet, and restrained gold palette.
- `GAMEPLAY VISUALIZATION` disclosure is visible on every scene.
- No raw app screenshots, browser chrome, debug panels, or personal data are used.
- Landscape, vertical, and teaser compositions are generated independently from the same motion system rather than crop-transforming an app recording.
- The visual sequence shows clear cause and effect for counter distribution, ability usage, usage reset, Undo, dungeon path, and Initiative.

## Marketing integrity

- The commercial does not advertise unverified target/sacrifice selection, Echo, ARGUS, or offline recovery.
- The commercial does not depict mandatory phase tracking or authoritative rules adjudication.
- `COMING SOON` is used because a verified public download URL is not present in the repository.
- No third-party music or card artwork is used. The score is generated from an original procedural synthesis command.

## Remaining production limitation

No human or properly licensed professional narrator was available in the current environment. The final video renders use the original instrumental score and explanatory on-screen copy. `narration-script.md` is performance-ready for a later recording pass; the audio file is intentionally not represented as complete narration.
