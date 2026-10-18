# Commercial Release Gates

Review date: 2026-10-18. This document is an engineering readiness assessment,
not legal clearance, store approval, or a claim of native-device certification.

The release-candidate dependency audit reports zero known npm vulnerabilities,
including production and development dependencies. This result is time-bound and
does not replace recurring supply-chain review.

## Available Target

This repository provides a React/TypeScript PWA and portable platform interfaces. No Swift
package, Xcode project, Swift Playgrounds app, Android Gradle project, signing
configuration, or store submission package is present. Web build/test results
cannot establish native compatibility beyond the portable architectural boundary.
Native builds, signing, VoiceOver/TalkBack, battery endurance and physical-device
permission/background behavior remain release gates.

## Rights and Distribution Blockers

- [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy)
  requires freely accessible fan content and contains trademark/IP restrictions.
  Public card images and Oracle text are not evidence of commercial permission.
  Product pricing, app-store distribution, artwork, logos, dungeon text and
  third-party crossover rights require owner/legal review. No license grant was
  obtained in this implementation.
- Existing Scryfall attribution and original card copyright markings must remain.
  The [Scryfall API documentation](https://scryfall.com/docs/api) returned HTTP 403
  during this audit; current service/commercial-use terms require independent
  verification before distribution. Do not treat an API response as an IP license.
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  require appropriate privacy and IP compliance. Developer account, signing,
  native permission purpose strings, privacy manifest, store screenshots,
  support contact and privacy-policy URL have not been verified.
- [Google Play Data Safety requirements](https://support.google.com/googleplay/android-developer/answer/10787469)
  require disclosures covering the shipped app and its SDKs. An actual native
  dependency/permission inventory and signed release artifact are prerequisites.
- Dependency licenses and existing visual-asset provenance require an owner-approved
  distribution inventory. No conclusion that all existing artwork is cleared is made.

## Privacy Inventory

Gameplay state, voice configuration/enrollment, personalization, card caches,
pending choices and session snapshots use local persistence ports. New Game is a
gameplay reset, not an account/voice/profile deletion request. Voice reset and
cache deletion remain separate controls. A commercial privacy statement must
explain these differences and data-retention/deletion behavior.

Scryfall queries and image requests contact third parties. Deck Nexus/Hub/shared
sessions use their existing adapters and must disclose the actual deployed
transport, authentication, retention and recipients. Private deck snapshots and
workflow choices are excluded from the public gameplay projection.

The web microphone adapter requests permission and exposes lifecycle stop paths.
Do not advertise all speech recognition as on-device without verifying the chosen
runtime/provider. ARGUS native camera capability is an adapter boundary, not a
verified camera implementation. No new telemetry, advertising or crash-reporting
SDK was added. Existing and future native SDK disclosures require a separate
binary/dependency review.

## Repeatable Device Qualification

On each supported native target, run a complete physical game with small and
large text, VoiceOver/TalkBack, reduced motion, permission denial/revocation,
screen lock, background/foreground, airplane mode and network recovery. Interrupt
target selection before costs, then interrupt after costs before resolution;
verify exactly-once effects and retained costs. Test a large battlefield, many
pending actions, camera/microphone contention, and storage-full conditions.

Current persistence saves a synchronous fallback and serializes durable writes.
If both stores fail, a persistent warning tells the player to keep Lite open and
export a backup. Durable recovery cannot be guaranteed without writable storage;
device-level destructive crash testing remains a release gate.
Undo snapshots are runtime history; pending workflows and current canonical state
are persisted. Cross-restart full Undo history is not claimed.

## Feature Support Gate

The bounded ability grammar must not be marketed as comprehensive Magic rules
automation. Complex reflexive/conditional abilities, unmodeled cost modifiers,
arbitrary grant templates and unsupported target restrictions remain manual.
Native and shared-session simultaneous-client qualification, endurance profiling,
and first-time-user usability studies are not replaced by unit/browser tests.
