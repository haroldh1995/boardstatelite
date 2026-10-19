# BoardState Lite Live Feature Test Report

**Run:** isolated local production preview at `http://127.0.0.1:4174`  
**Viewport:** 390 x 844 portrait  
**Commit:** `d570bfc9da7636dd2f3bebb735e187ec2eedcd34`  
**Build:** `preflight-live-20261018233615`  
**Raw evidence:** `../raw/page@731977029f27f77cbc5482576b31bac5.webm`  
**Machine-readable results:** `feature-test-results.json`

The run used a fresh Playwright browser context and the application's real production preview. It began from the repository's realistic reference battlefield, used the real UI to clear into a new game, and used the live Scryfall search path for card entry. No personal browser profile, account, or production session was used.

| Time     | Feature                 | Scenario                                                 | Expected                                                               | Observed                                                                                       | Status |
| -------- | ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| 00:00:03 | Ability Focus           | Switch the activation surface and inspect Sol Ring.      | Activated permanents highlight and expose current ability text/costs.  | Sol Ring was highlighted; its tap ability was inspected and committed into pending resolution. | PASS   |
| 00:00:05 | Activate Field          | Invoke a tracked trigger from the reference battlefield. | Tracked triggers use the production workflow without invented choices. | Activate Field opened and accepted a tracked trigger.                                          | PASS   |
| 00:00:06 | New Game                | Clear the reference session.                             | Game state resets and life returns to 40.                              | New Game completed and the clean session opened.                                               | PASS   |
| 00:00:07 | Life / Full-Screen Life | Adjust life five times down and twice up.                | Cumulative net delta is shown and presentation is unchanged.           | 40 became 37 and the visible delta became -3.                                                  | PASS   |
| 00:00:08 | Player counters         | Add Rad and a renamed custom tracker.                    | Layout changes remain presentation-only.                               | Rad and Progress were added without changing life state.                                       | PASS   |
| 00:00:09 | Commander Damage        | Add Atraxa and record one combat-damage increment.       | Per-commander damage and life update coherently.                       | Atraxa was added as an individual source and one combat increment was recorded.                | PASS   |
| 00:00:11 | Scryfall                | Search for and add Sol Ring.                             | A real provider result is added through the card-entry path.           | Sol Ring was found through Scryfall and added to the battlefield.                              | PASS   |
| 00:00:13 | Turn / land tracking    | Record the turn boundary and continue.                   | Turn land and battlefield state remain distinct.                       | End Turn and the next Start Turn boundary were accepted.                                       | PASS   |
| 00:00:14 | Dungeons & Initiative   | Venture into a valid room and take initiative.           | Dungeon progress and initiative remain first-class game state.         | Initiative was assigned and Cave Entrance was entered through the interactive map.             | PASS   |

## Coverage not claimed by this recording

Targeted counter selection, sacrifice selection, offline recovery, and Echo/ARGUS live recognition were not promoted as advertisement claims in this recording. Their repository-level coverage remains in the existing automated suite, but no new live-footage claim is made here.
