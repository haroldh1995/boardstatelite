# BoardState Lite Live Feature Test Report — Revision 02

## Run metadata

- Build: local Vite app at `http://127.0.0.1:4174/`
- Source commit at capture: `380b0a0612e2d5c63e13f05f64c232c424bc376d`
- Capture suite: `tests/e2e/marketing-capture-pass.spec.ts`
- Browser: Chromium, isolated Playwright context, 430x900 portrait
- Result: 2 scenarios passed

## Results

| Feature | Scenario | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| Life and Full-Screen Life | Adjust life twice, enter Full-Screen Life, return | Life reaches 42 and presentation changes without a gameplay reset | Life reached 42 and standard battlefield was restored | PASS | `core-feature-pass.webm`, `core-01-field.png`, `core-02-full-life.png` |
| Deterministic counters | Resolve Cathars' Crusade from Activate Field | Qualifying creatures receive counters without target selection | Counter state changed on the qualifying creatures | PASS | `core-feature-pass.webm`, `core-03-counter-pending.png`, `core-04-counter-result.png` |
| Ability Focus | Switch mode and inspect Life Relic | Activated ability is discoverable and text is readable | Life Relic ability and once-per-turn text were shown | PASS | `core-feature-pass.webm`, `core-05-ability-focus.png`, `core-06-ability-inspection.png` |
| Once-per-turn usage | Activate Life Relic and resolve it | Life changes and usage is recorded | Life reached 45 and the resolved action recorded its usage | PASS | `core-feature-pass.webm`, `core-07-ability-result.png` |
| Undo | Undo the Life Relic transaction | Previous life value is restored coherently | Life returned to 42 | PASS | `core-feature-pass.webm`, `core-08-undo.png` |
| Dungeons and Initiative | Open User Tools, take Initiative, enter Secret Entrance | Initiative and room state are visible | Initiative was taken and Secret Entrance became current | PASS | `dungeon-initiative-pass.webm`, `dungeon-01-initiative-path.png` |
| Target selection | Activate a target-requiring ability | Eligible target selector appears and updates state | Live target selector was not exposed | BLOCKED, OMITTED |
| Sacrifice selection | Activate a sacrifice-requiring ability | Eligible sacrifice selector appears and updates state | Could not reach a valid sacrifice selector after the target workflow remained pending | BLOCKED, OMITTED |
| Offline recovery | Restore active session without network | Local session survives interruption | Not run in this capture environment | NOT TESTED, OMITTED |
| Echo / ARGUS | Run live speech/camera recognition | Genuine observation is captured and interpretable | Not run in this capture environment | NOT TESTED, OMITTED |

The promotional renders use only PASS rows.
