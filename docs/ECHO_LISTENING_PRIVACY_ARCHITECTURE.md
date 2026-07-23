# Echo Listening Lifecycle and Privacy Architecture

BoardState Lite owns only the local microphone framework required for future
Echo listening features. It does not recognize speech, parse Magic commands,
infer actions, or send audio to any remote service.

## Boundary

Lite remains a local-first tabletop companion. The listening foundation may
prepare audio sessions and expose deterministic lifecycle state, but future
speech recognition, command interpretation, speaker verification, AI
recommendations, and authoritative rules decisions must be layered on top of
the existing Ambient Gameplay Engine and Canonical Ambient Event Pipeline.

The original BoardState application remains responsible for authoritative
rules, advanced gameplay, simulations, and shared authority. BoardState Hub
remains responsible for profiles, friends, notifications, cloud backup, and
ecosystem services.

## Lifecycle

The microphone service is the single entry point for listening state. It uses
explicit lifecycle states:

- idle
- preparing
- requestingPermission
- permissionGranted
- permissionDenied
- initializing
- ready
- listening
- temporarilyPaused
- interrupted
- recovering
- stopping
- stopped
- failed

Transitions are validated centrally. Invalid transitions are recorded in
diagnostics and never mutate battlefield state.

## Privacy Defaults

Voice features are disabled by default. Ambient listening is disabled by
default. Push-to-talk and always-listening settings are reserved for future
milestones and remain disabled.

The privacy contract is:

- explicit opt-in is required
- raw audio is not retained
- cloud transcription is disabled
- continuous conversation recording is disabled
- local processing is preferred for future speech work
- active listening requires a visible indicator
- stopping or disabling voice features shuts down the audio session immediately

## Persistence

Saved fields persist voice settings and safe listening metadata. Active audio
sessions are not restored from imported or legacy saves unless runtime code has
already validated the session. Older saves without voice or listening fields
migrate to voice-disabled, idle defaults without deleting unknown legacy data.

## Ambient Gameplay Integration

Listening state tracks the current Ambient Gameplay mode but does not create a
new turn, phase, or gameplay authority. Recovery Mode suspends listening. App
backgrounding, page hiding, permission revocation, device changes, and
foreground restoration are routed through the same service.

## Future Extension Points

Future Echo milestones should reuse this service for microphone access and
should route interpreted actions through the Canonical Ambient Event Pipeline.
No future milestone should open a separate microphone stream, keep a competing
lifecycle state machine, or mutate battlefield state directly from listening
code.

## Personal Voice Enrollment

The ECHO-08 enrollment layer creates a local speaker profile for future speaker
verification only. It does not recognize speech, transcribe words, parse Magic
commands, or infer gameplay actions.

Enrollment is one unified profile made from multiple Magic-themed phrases at
quiet, normal, and loud table voices. Each accepted sample stores compact
acoustic metrics, quality metadata, volume coverage, environment, microphone
position, and a deterministic feature fingerprint. Raw audio is discarded after
quality analysis and is never serialized into saved fields or exports.

The profile supports replacement, deletion, additional samples, recalibration,
environment calibration, and device-position calibration. Calibration records
only aggregate noise and microphone-position metadata so future confidence
systems can account for a home table, local game store, tournament, quiet room,
or custom setting without retaining recordings.

Voice enrollment state lives under `field.settings.voice.enrollment` and
migrates missing or corrupted older data to safe local defaults. Deleting a
profile removes all samples, calibration records, and acoustic model data while
leaving microphone settings under the user's control.
