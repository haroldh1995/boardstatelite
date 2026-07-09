# Baord State Lite

Baord State Lite is a mobile-first Magic: The Gathering companion app for tracking a personal physical-table battlefield. It is not a full digital rules engine; it focuses on life, player counters, relevant totals, battlefield objects, generic placeholders, tokens, selected supported card interactions, and clear undoable summaries.

## Feature Summary

- Personal life tracker with press-and-hold gain/loss, exact entry, undo, redo, and player counters for poison, energy, experience, rad, commander damage, and custom counter data.
- Relevant totals strip for lands, nonbasic lands, artifacts, hand, exile, and additional totals inferred from tracked permanents.
- Scryfall search with actual Scryfall card data/images, print selection, double-faced card face data, offline cached card data where available, and no fake generated art for real cards.
- Organized battlefield sections for Creatures, Other Permanents, Attachments, and Generics & Tokens.
- Generic placeholders for ordinary cards, unknown cards, tokens, and bookkeeping objects that should not contribute card abilities.
- Long-press permanent menu for counters, shield/stun/keyword/custom counters, status flags, Depower, base power/toughness overrides, Stop Tracking Card, Resume Tracking Card, stack removal, and transformation tools.
- Activate Field resolves supported initiating effects, replacement effects, static recalculations, reactive triggers, tokens, counters, life changes, power/toughness updates, and a readable summary/details log as one undoable transaction.
- First-launch tracking warning, rules-learning tutorial access from Tools, screen-reader labels, reduced-motion setting, sound/haptic preference storage, export/import, local persistence, PWA install support, and GitHub Pages deployment.

## Supported Automated Card Logic

- Anim Pakal, Thousandth Moon initiating attack trigger.
- Cathars' Crusade creature-entered trigger.
- Doubling Season token and counter replacement effects.
- Rampaging Baloths landfall token creation.
- Soul Warden and Essence Warden creature-entered life gain.
- Impact Tremors opponent damage summary.
- User-defined custom effects for activate-field actions.

Unsupported cards can still be tracked as permanents, receive counters, count toward totals, be depowered, be transformed, and be removed, but unsupported Oracle text is not guessed.

## Generic Placeholders

Use generic placeholders for permanents whose abilities should not be automated. Placeholders can receive counters, track power/toughness, be tapped, be transformed, count toward relevant totals, and be replaced later by triple-tapping the placeholder and choosing a Scryfall card.

Replacing a placeholder preserves counters, statuses, stack quantity, attachments, damage, and power/toughness overrides. Replacement does not retroactively fire enter-the-battlefield triggers; future automation begins after the replacement.

## Stop Tracking Card

Stop Tracking Card is separate from Depower. A Not Tracked card stays visible, keeps counters/statuses, counts toward totals, and remains eligible to receive effects from tracked cards. Its own supported triggered abilities, replacement effects, static effects, background watcher responses, and attached-card automation are ignored until Resume Tracking Card is used.

## Activate Field

Activate Field is the normal field-resolution control. It resolves modeled initiating effects and reactive chains, applies replacement effects such as Doubling Season, recalculates static values, condenses repeated trigger chains into summaries, and keeps the entire activation undoable. Hold Activate Field to open Transform All.

Use Correction Only for bookkeeping changes that should not trigger landfall, replacement effects, or watcher responses.

## Tutorial And Accessibility

The first-launch warning explains the core tracking model before field access. Tools includes a Rules-Learning Tutorial that can be reopened later for reminders about tracked cards, generic placeholders, Correction Only, Activate Field, and Stop Tracking Card. Dialogs use accessible labels, focus trapping, Escape/outside-tap cancellation where safe, screen-reader text, and reduced-motion support.

## PWA And Offline Notes

The app name and PWA manifest name are exactly `Baord State Lite`. The Vite PWA service worker caches the app shell, Scryfall card API responses, and previously viewed Scryfall card images. Offline search shows cached card data where available and displays clear offline messaging when no cached result exists. Updates are prompt-based so active physical games are not interrupted.

## Data Safety

- Scryfall does not require an API key.
- Local field data is saved in IndexedDB with localStorage fallback.
- Older saves are migrated with safe defaults for missing fields.
- Import validates the expected schema and sanitizes labels.
- Imported data is never executed as code.
- Export creates a JSON backup of the current local field.

## Development Setup

```bash
npm install
npm run dev
```

## Quality Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
npm run test:visual
```

Update visual baselines only after intentional UI changes:

```bash
npm run test:visual:update
```

## Reference Visual Fixture

For local and test-only visual audits, open:

```text
http://127.0.0.1:5173/?fixture=reference
```

The fixture loads a production-style battlefield with life 40, counters, tracked cards, attachments, resource chips, and bottom controls. It is gated to local/dev hosts and is not available as a normal field on the GitHub Pages deployment.

Current screenshots live in `docs/screenshots/` and Playwright visual baselines live in `tests/e2e/visual.spec.ts-snapshots/`.

## Deployment

The Vite config uses `/boardstatelite/` as the base path in GitHub Actions and `/` locally. The `Deploy GitHub Pages` workflow runs tests, builds `dist`, and publishes the result through GitHub Pages.

Production verification should confirm the deployed app loads, the life tracker appears, Scryfall search returns real card images, a card can be added, Activate Field is present, the wallpaper remains visible, and no console-breaking runtime errors appear.

## Known Limitations

- Baord State Lite automates only explicitly modeled card interactions.
- Opponent battlefield and opponent life are summarized values, not a full opponent-board simulator.
- The rules-learning tutorial is a lightweight in-app guide, not a full animated MTG course.
- Offline Scryfall behavior depends on previously cached card data and images.
- Browser support for PWA install prompts, haptics, and speech behavior varies by platform.

## Scryfall Attribution

Card names, Oracle text, print data, and images are provided by Scryfall. Baord State Lite is unofficial Fan Content and is not produced, endorsed, supported, or affiliated with Wizards of the Coast.
