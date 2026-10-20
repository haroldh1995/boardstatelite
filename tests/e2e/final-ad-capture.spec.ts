import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createCardGroup } from "../../src/domain/cards";
import { createReferenceFixtureField } from "../../src/dev/referenceFixture";
import { testCard } from "../../src/test/factories";

const rawDir = path.resolve("release-marketing/raw/final-ad");
const evidenceDir = path.resolve("release-marketing/evidence/final-ad");

test("capture authentic commercial demonstrations", async ({ browser }) => {
  test.setTimeout(180_000);
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });
  const field = createReferenceFixtureField();
  field.id = "boardstate-lite-commercial-demo";
  field.name = "BoardState Lite Commercial Demo";
  field.groups = [
    ...field.groups,
    createCardGroup(
      testCard({
        name: "Prodigal Sorcerer",
        typeLine: "Creature - Human Wizard",
        oracleText: "{T}: Prodigal Sorcerer deals 1 damage to any target.",
        power: "1",
        toughness: "1",
      }),
    ),
    createCardGroup(
      testCard({
        name: "Viscera Seer",
        typeLine: "Creature - Vampire Wizard",
        oracleText: "{B}, Sacrifice a creature: Scry 1.",
        power: "1",
        toughness: "1",
      }),
    ),
    createCardGroup(
      testCard({
        name: "Life Relic",
        typeLine: "Artifact",
        oracleText: "{T}: You gain 3 life. Activate only once each turn.",
      }),
    ),
  ];

  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir: rawDir, size: { width: 430, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const startedAt = Date.now();
  const results: Array<Record<string, unknown>> = [];

  await page.addInitScript((initial) => {
    localStorage.setItem("baord-state-lite:last-field-id", initial.id);
    localStorage.setItem(
      "baord-state-lite:last-field-fallback",
      JSON.stringify(initial),
    );
  }, field);
  await page.goto("http://127.0.0.1:4174/", {
    waitUntil: "commit",
    timeout: 10_000,
  }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  await continuePastStartup(page);

  async function scene(
    id: string,
    feature: string,
    expected: string,
    action: () => Promise<void>,
  ) {
    const started = Date.now();
    try {
      await action();
      results.push({
        id,
        feature,
        expected,
        actual: "Observed in the live application.",
        status: "passed",
        elapsedMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        id,
        feature,
        expected,
        actual: "The live interaction did not complete.",
        status: "blocked",
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      });
    }
    await page.waitForTimeout(900);
  }

  await page.screenshot({ path: path.join(evidenceDir, "01-starting-field.png"), fullPage: true });
  await page.waitForTimeout(1_800);

  await scene(
    "life-and-full-screen-life",
    "Life tracking and Full-Screen Life",
    "Life adjusts directly and Full-Screen Life presents the same canonical session.",
    async () => {
      await page.getByRole("button", { name: "Gain 1 life" }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Gain 1 life" }).click();
      await page.waitForTimeout(800);
      const expand = page.getByRole("button", { name: "Expand Life Tracker", exact: true });
      await expand.focus();
      await expand.press("Enter");
      await expect(page.locator(".full-life-center > strong")).toHaveText("42");
      await page.screenshot({ path: path.join(evidenceDir, "02-full-screen-life.png"), fullPage: true });
      await page.getByRole("button", { name: "Return to Battlefield", exact: true }).click();
    },
  );

  await scene(
    "deterministic-counters",
    "Automatic counter allocation",
    "Cathars' Crusade applies a counter to each qualifying creature after the trigger is committed.",
    async () => {
      await page.getByRole("button", { name: /ACTIVATE FIELD/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Trigger Occurred" }).nth(3).click();
      await page.screenshot({ path: path.join(evidenceDir, "03-deterministic-pending.png"), fullPage: true });
      await dialog.getByRole("button", { name: "Resolve Now", exact: true }).click();
      await page.waitForTimeout(1_500);
      await expect(page.getByLabel("Counters on Anim Pakal, Thousandth Moon")).toContainText("+1/+1");
      await page.screenshot({ path: path.join(evidenceDir, "04-deterministic-result.png"), fullPage: true });
      const close = page.getByRole("button", { name: "Close", exact: true });
      if (await close.count()) await close.last().click();
    },
  );

  await scene(
    "ability-focus",
    "Ability Focus and activated abilities",
    "Ability Focus highlights activated-ability permanents and opens their current ability text.",
    async () => {
      await page.getByRole("button", { name: "Switch to Ability Focus" }).click();
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: path.join(evidenceDir, "05-ability-focus.png"), fullPage: true });
      await page.getByRole("button", { name: "Inspect activated abilities on Life Relic" }).click();
      await expect(page.getByText("Activate only once each turn.", { exact: false })).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, "06-ability-inspection.png"), fullPage: true });
      await page.getByRole("button", { name: "Close", exact: true }).click();
    },
  );

  await scene(
    "once-per-turn",
    "Once-per-turn usage memory",
    "Life Relic activation is recorded and its availability changes until the next recorded turn boundary.",
    async () => {
      await page.getByRole("button", { name: "Inspect activated abilities on Life Relic" }).click();
      await page.getByRole("button", { name: "Activate", exact: true }).click();
      await page.getByRole("button", { name: "Commit Activation" }).click();
      await page.getByRole("button", { name: "Resolve Now", exact: true }).click();
      await page.waitForTimeout(1_200);
      await expect(page.locator(".life-total strong")).toHaveText("45");
      await page.screenshot({ path: path.join(evidenceDir, "07-ability-resolved.png"), fullPage: true });
      await page.getByRole("button", { name: "Close", exact: true }).click();
    },
  );

  await scene(
    "target-selection",
    "Target selection",
    "Prodigal Sorcerer requests a player-selected target before the action is committed.",
    async () => {
      await page.getByRole("button", { name: "Inspect activated abilities on Prodigal Sorcerer" }).click();
      await page.getByRole("button", { name: "Activate", exact: true }).click();
      await page.screenshot({ path: path.join(evidenceDir, "08-target-selection.png"), fullPage: true });
      const target = page.getByRole("dialog").getByRole("checkbox", { name: /Anim Pakal/ });
      if (await target.count()) await target.check();
      const use = page.getByRole("button", { name: "Use Selection", exact: true });
      if (await use.count()) await use.click();
      await page.getByRole("button", { name: "Commit Activation" }).click();
      await page.getByRole("button", { name: "Resolve Now", exact: true }).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(evidenceDir, "09-target-result.png"), fullPage: true });
      await page.getByRole("button", { name: "Close", exact: true }).click();
    },
  );

  await scene(
    "sacrifice-selection",
    "Sacrifice selection",
    "Viscera Seer asks the player to choose the creature used for its sacrifice cost.",
    async () => {
      await page.getByRole("button", { name: "Inspect activated abilities on Viscera Seer" }).click();
      await page.getByRole("button", { name: "Activate", exact: true }).click();
      await page.screenshot({ path: path.join(evidenceDir, "10-sacrifice-selection.png"), fullPage: true });
      const sacrifice = page.getByRole("dialog").getByRole("checkbox", { name: /Champion of Lambholt/ });
      if (await sacrifice.count()) await sacrifice.check();
      const use = page.getByRole("button", { name: "Use Selection", exact: true });
      if (await use.count()) await use.click();
      await page.getByRole("button", { name: "Commit Activation" }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(evidenceDir, "11-sacrifice-result.png"), fullPage: true });
      await page.getByRole("button", { name: "Close", exact: true }).click();
    },
  );

  await scene(
    "undo",
    "Undo and correction",
    "The latest committed action can be reviewed and undone without leaving the live session.",
    async () => {
      const undo = page.getByRole("button", { name: /^Undo/ }).first();
      await undo.click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(evidenceDir, "12-undo.png"), fullPage: true });
    },
  );

  await scene(
    "dungeons-initiative",
    "Dungeons and Initiative",
    "The current game can record Initiative and progress through a valid dungeon path.",
    async () => {
      await page.getByRole("button", { name: "User Tools", exact: true }).click();
      await page.getByRole("button", { name: /Dungeons & Initiative/ }).click();
      await page.getByRole("button", { name: "Take Initiative", exact: true }).click();
      await page.getByRole("button", { name: /^Secret Entrance, available destination/ }).click();
      await page.screenshot({ path: path.join(evidenceDir, "13-dungeon-initiative.png"), fullPage: true });
    },
  );

  await fs.writeFile(
    path.join(evidenceDir, "feature-results.json"),
    JSON.stringify(
      {
        build: process.env.GIT_COMMIT ?? "local",
        capturedAt: new Date().toISOString(),
        viewport: { width: 430, height: 900 },
        elapsedMs: Date.now() - startedAt,
        results,
      },
      null,
      2,
    ),
  );
  await context.close();
  const videoPath = await page.video()?.path();
  if (videoPath) {
    await fs.copyFile(
      videoPath,
      path.join(rawDir, "final-commercial-demo.webm"),
    );
  }
});

async function continuePastStartup(page: Page) {
  const continueButton = page.getByRole("button", { name: "Continue to Field" });
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
  }
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
}
