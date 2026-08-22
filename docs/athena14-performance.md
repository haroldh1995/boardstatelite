# ATHENA-14 Performance Record

Measured before and after optimization on the local Vitest/jsdom development
environment on 2026-08-21. The hotspot fixture contained 110 battlefield
groups, 20 token stacks representing more than 1,000 tokens, 55 graveyard
groups, 24 exile groups, attachments, counters, and 10 prepared actions. Values
are five-run warm averages and are engineering comparisons rather than
production-device guarantees. The permanent stress fixture additionally
includes 10 supported static relationships, multiple replacements, and multiple
triggers.

| Workflow                    | Baseline | Optimized |                   Change |
| --------------------------- | -------: | --------: | -----------------------: |
| Derived-state build         |  48.7 ms |   43.5 ms |                   -10.7% |
| Prepared-turn revalidation  |  85.2 ms |   51.0 ms |                   -40.1% |
| Target candidate generation |  0.17 ms |   0.18 ms | Within measurement noise |
| 100-field Catch Me Up batch |  4.29 ms |   4.20 ms | Within measurement noise |

The measured planner hotspot was repeated forecast-environment construction.
ATHENA-14 now shares one immutable forecast environment across a revalidation
pass and reuses prepared forecasts when their canonical fingerprint remains
current. The derived-state path now reuses its already-built awareness context
when constructing the dependency graph and avoids duplicate canonical
fingerprinting on cache misses.

Automated budgets are intentionally generous to avoid machine-dependent flaky
tests. Development diagnostics retain bounded samples only, stay out of the
production gameplay UI, and collect no microphone content.

## ATHENA-15 Final Verification

The final integration pass re-ran the same heavy fixture on 2026-08-22. A
ten-sample warm median measured 145.102 ms for an uncached derived-state build
and 2.711 ms for stable prepared-turn revalidation. Separate five-sample runs
measured total counting at 0.275-0.289 ms, target candidate generation at
0.327-0.474 ms, and a 100-field Catch Me Up batch at 6.344-10.730 ms.

The shared Windows test host varied substantially between consecutive runs, so
these values are recorded as final budget verification rather than a claimed
device-level improvement over the ATHENA-14 sample. Every measured workflow
remained within its deterministic test budget, and ATHENA-15 did not change the
derived-state, dependency-graph, or prepared-forecast optimization algorithms.
