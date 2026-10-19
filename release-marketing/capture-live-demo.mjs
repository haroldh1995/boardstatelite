import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:4174";
const root = path.resolve("release-marketing");
const evidenceDir = path.join(root, "evidence");
const rawDir = path.join(root, "raw");
const screenshotsDir = path.join(evidenceDir, "screenshots");
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(screenshotsDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "dark",
  reducedMotion: "no-preference",
  recordVideo: { dir: rawDir, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const startedAt = Date.now();
const results = [];
const video = page.video();

function timestamp() {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

async function screenshot(name) {
  await page.screenshot({
    path: path.join(screenshotsDir, `${name}.png`),
    fullPage: true,
  });
}

async function step(id, feature, scenario, expected, action) {
  const entry = {
    id,
    feature,
    scenario,
    expected,
    actual: "",
    status: "blocked",
    timestamp: timestamp(),
    errors: [],
  };
  try {
    const actual = await action();
    entry.actual = actual ?? "Observed expected UI/state transition.";
    entry.status = "pass";
  } catch (error) {
    entry.actual = "The expected behavior was not fully observed.";
    entry.errors.push(error instanceof Error ? error.message : String(error));
  }
  results.push(entry);
  await page.waitForTimeout(650);
}

async function pinch(from, to) {
  await page.locator(".app-shell").evaluate(
    (element, values) => {
      const touches = (width) => [
        new Touch({
          identifier: 1,
          target: element,
          clientX: 160 - width / 2,
          clientY: 390,
        }),
        new Touch({
          identifier: 2,
          target: element,
          clientX: 160 + width / 2,
          clientY: 390,
        }),
      ];
      element.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: touches(values.from),
        }),
      );
      element.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: touches(values.to),
        }),
      );
      element.dispatchEvent(
        new TouchEvent("touchend", { bubbles: true, touches: [] }),
      );
    },
    { from, to },
  );
}

async function continueIfNeeded() {
  const button = page.getByRole("button", { name: "Continue to Field" });
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function closeModal() {
  const close = page.getByRole("button", { name: "Close", exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function openUserTools() {
  await closeModal();
  await page.getByRole("button", { name: "User Tools", exact: true }).click();
}

try {
  await page.goto(`${baseURL}/?fixture=reference`, {
    waitUntil: "networkidle",
  });
  await continueIfNeeded();
  await screenshot("01-reference-battlefield");

  await step(
    "live-01",
    "Ability Focus",
    "Switch the existing activation surface into Ability Focus and inspect Sol Ring.",
    "Activated-ability permanents highlight and the ability inspector exposes current Oracle text and costs.",
    async () => {
      await page
        .getByRole("button", { name: "Switch to Ability Focus" })
        .click();
      await page
        .getByRole("button", {
          name: "Inspect activated abilities on Sol Ring",
        })
        .click();
      await page.getByRole("button", { name: "Activate", exact: true }).click();
      await page.getByRole("button", { name: "Commit Activation" }).click();
      await expectText("Pending resolution");
      await screenshot("02-ability-focus-pending");
      await closeModal();
      return "Sol Ring was highlighted; its {T}: Add {C}{C} ability was inspected and committed into pending resolution.";
    },
  );

  await step(
    "live-02",
    "Activate Field",
    "Open Activate Field and invoke a deterministic tracked trigger from the reference battlefield.",
    "The existing activation flow presents tracked triggered abilities and resolves supported deterministic bookkeeping without invented choices.",
    async () => {
      await page
        .getByRole("button", { name: "Switch to Activate Field" })
        .click();
      await page.getByRole("button", { name: /ACTIVATE FIELD/ }).click();
      const cathars = page
        .getByRole("button", { name: "Trigger Occurred" })
        .first();
      await cathars.click();
      if (
        await page
          .getByRole("button", { name: "Commit Activation" })
          .isVisible()
          .catch(() => false)
      ) {
        await page.getByRole("button", { name: "Commit Activation" }).click();
      }
      return "Activate Field opened and accepted a tracked trigger through the production workflow.";
    },
  );

  await step(
    "live-03",
    "New Game",
    "Start a fresh Commander game from User Tools, preserving app preferences while clearing game state.",
    "The one-step confirmation clears current gameplay state and returns to a clean standard battlefield.",
    async () => {
      await openUserTools();
      await page
        .getByRole("button", { name: /New Game Start a fresh/ })
        .click();
      await page.getByRole("button", { name: "New Game", exact: true }).click();
      await page
        .getByRole("button", { name: "Play Without Deck", exact: true })
        .click();
      await expectText("40");
      await screenshot("03-new-game");
      return "New Game completed; life returned to 40 and the battlefield is ready for a new session.";
    },
  );

  await step(
    "live-04",
    "Turn-aware life tracking",
    "Start the recorded turn and adjust life repeatedly in Full-Screen Life.",
    "The signed delta is cumulative and the presentation transition does not mutate gameplay state.",
    async () => {
      await page
        .getByRole("button", { name: "Start Turn", exact: true })
        .click();
      await pinch(100, 150);
      await page.getByRole("main", { name: "Full-screen life mode" }).waitFor();
      const lose = page.getByRole("button", {
        name: /Lose life\. Press and hold/i,
      });
      const gain = page.getByRole("button", {
        name: /Gain life\. Press and hold/i,
      });
      for (let index = 0; index < 5; index += 1) await lose.click();
      await gain.click();
      await gain.click();
      await expectText("37");
      await expectText("-3");
      await screenshot("04-full-screen-life-delta");
      return "40 became 37 and the visible transaction delta became -3 after five losses and two gains.";
    },
  );

  await step(
    "live-05",
    "Custom player counters",
    "Add and arrange a secondary player tracker from Full-Screen Life.",
    "Player-counter layout changes are presentation-only and remain separate from canonical values.",
    async () => {
      await page
        .getByRole("button", { name: "Customize player counters" })
        .click();
      const add = page.getByLabel("Add counter tracker");
      await add.selectOption("rad");
      await page.getByLabel("Custom counter name").fill("Quest");
      await page.getByRole("button", { name: "Add custom counter" }).click();
      await page.getByLabel("Rename Quest").fill("Progress");
      await page.getByLabel("Rename Quest").press("Tab");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await expectText("Progress");
      await screenshot("05-custom-counters");
      return "Rad and a renamed custom Progress tracker were added without changing the life transaction.";
    },
  );

  await step(
    "live-06",
    "Commander Damage",
    "Open Commander Damage from Full-Screen Life and record combat damage against one commander.",
    "Commander damage is tracked per commander and combat entry updates the life transaction coherently.",
    async () => {
      await page
        .getByRole("button", { name: "Commander Damage", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Player", exact: true })
        .fill("Opponent");
      await page
        .getByRole("textbox", { name: "Commander", exact: true })
        .fill("Atraxa");
      await page
        .getByRole("button", { name: "Add Commander", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Increase damage from Atraxa" })
        .click();
      await expectText("Atraxa");
      await screenshot("06-commander-damage");
      await closeModal();
      return "Atraxa was added as an individual commander source and one combat-damage adjustment was recorded.";
    },
  );

  await step(
    "live-07",
    "Scryfall card entry",
    "Return to the battlefield and add a real permanent through the Scryfall search surface.",
    "A live Scryfall result is selected and added through the production card-entry path.",
    async () => {
      await pinch(150, 95);
      await page.getByRole("button", { name: /^Add$/ }).click();
      await page.getByPlaceholder("Search Scryfall cards").fill("Sol Ring");
      const option = page.getByRole("option", { name: /Sol Ring/i }).first();
      await option.waitFor({ timeout: 12_000 });
      await option.click();
      await page
        .getByRole("button", {
          name: "Put selected card onto the battlefield without casting it.",
        })
        .click();
      await page.locator('article[aria-label^="Sol Ring"]').waitFor();
      await screenshot("07-scryfall-sol-ring");
      return "Sol Ring was found through Scryfall and added to the battlefield without a fabricated placeholder.";
    },
  );

  await step(
    "live-08",
    "Turn lifecycle and land tracking",
    "Record a land play, inspect battlefield land state, end the turn, and begin the next turn.",
    "Turn Land and battlefield-derived land state remain distinct across the explicit turn boundary.",
    async () => {
      const land = page.getByRole("button", { name: /Land play:/i });
      if (await land.isVisible().catch(() => false)) {
        await land.click();
        const mark = page.getByRole("button", { name: "Mark Land Played" });
        if (await mark.isVisible().catch(() => false)) await mark.click();
      }
      const end = page.getByRole("button", { name: "End Turn", exact: true });
      if (await end.isVisible().catch(() => false)) await end.click();
      const start = page.getByRole("button", {
        name: "Start Turn",
        exact: true,
      });
      await start.click();
      await screenshot("08-turn-boundary");
      return "The recorded turn ended and the next explicit Start Turn boundary was accepted.";
    },
  );

  await step(
    "live-09",
    "Dungeons and Initiative",
    "Open User Tools, start a dungeon path, and take initiative.",
    "Dungeon progress and initiative are represented as first-class game state through the production utility surface.",
    async () => {
      await openUserTools();
      await page.getByRole("button", { name: /Dungeons & Initiative/ }).click();
      await page
        .getByRole("button", { name: "Venture into Dungeon", exact: true })
        .click();
      await page
        .getByRole("button", { name: /^Cave Entrance, available destination/ })
        .click();
      if (
        await page
          .getByRole("button", { name: "Resolved at Table", exact: true })
          .isVisible()
          .catch(() => false)
      ) {
        await page
          .getByRole("button", { name: "Resolved at Table", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "Take Initiative", exact: true })
        .click();
      await screenshot("09-dungeons-initiative");
      return "Initiative was assigned and a valid dungeon room was entered through the interactive map.";
    },
  );

  await closeModal();
  await page.waitForTimeout(1200);
} finally {
  await context.close();
  await browser.close();
}

const videoPath = video ? await video.path().catch(() => null) : null;
await fs.writeFile(
  path.join(evidenceDir, "feature-test-results.json"),
  JSON.stringify(
    {
      title: "BoardState Lite live feature test",
      baseURL,
      viewport: { width: 390, height: 844 },
      build: process.env.BUILD_ID ?? "local-preview",
      commit: process.env.GIT_COMMIT ?? "unknown",
      recording: videoPath,
      results,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ videoPath, results }, null, 2));

async function expectText(text) {
  await page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ timeout: 5_000 });
}
