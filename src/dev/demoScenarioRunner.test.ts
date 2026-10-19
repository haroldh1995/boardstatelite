import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDemoScenarios, serializeDemoReport } from "./demoScenarioRunner";

describe("production demo scenario runner", () => {
  it("executes every isolated scenario and emits machine-readable results", () => {
    const report = runDemoScenarios({
      buildId: "vitest",
      commitId: "test-commit",
      now: "2026-10-18T00:00:00.000Z",
    });
    mkdirSync("output", { recursive: true });
    writeFileSync("output/demo-scenarios.json", serializeDemoReport(report));
    expect(report.format).toBe("boardstate-lite-demo-scenarios/v1");
    expect(report.isolatedSession).toBe(true);
    expect(report.status).toBe("passed");
    expect(report.scenarios).toHaveLength(9);
    expect(
      report.scenarios.every((scenario) => scenario.status === "passed"),
    ).toBe(true);
    expect(JSON.parse(serializeDemoReport(report))).toEqual(report);
  });
});
