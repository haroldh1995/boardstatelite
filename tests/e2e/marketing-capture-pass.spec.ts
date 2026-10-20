import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createCardGroup } from "../../src/domain/cards";
import { createReferenceFixtureField } from "../../src/dev/referenceFixture";
import { testCard } from "../../src/test/factories";

const rawDir = path.resolve("release-marketing/raw/verified-marketing");
const evidenceDir = path.resolve("release-marketing/evidence/verified-marketing");

test.describe.configure({ mode: "serial" });

test("capture verified core feature pass", async ({ browser }) => {
  test.setTimeout(120_000);
  const field = createReferenceFixtureField();
  field.id = "boardstate-lite-marketing-core";
  field.name = "BoardState Lite Marketing Core";
  field.groups = [
    ...field.groups,
    createCardGroup(
      testCard({
        name: "Life Relic",
        typeLine: "Artifact",
        oracleText: "{T}: You gain 3 life. Activate only once each turn.",
      }),
    ),
  ];
  await captureContext(browser, "core-feature-pass", field, async (page) => {
    await page.screenshot({ path: path.join(evidenceDir, "core-01-field.png"), fullPage: true });
    await page.getByRole("button", { name: "Gain 1 life" }).click();
    await page.waitForTimeout(450);
    await page.getByRole("button", { name: "Gain 1 life" }).click();
    await page.waitForTimeout(800);
    const expand = page.getByRole("button", { name: "Expand Life Tracker", exact: true });
    await expand.focus();
    await expand.press("Enter");
    await expect(page.locator(".full-life-center > strong")).toHaveText("42");
    await page.screenshot({ path: path.join(evidenceDir, "core-02-full-life.png"), fullPage: true });
    await page.getByRole("button", { name: "Return to Battlefield", exact: true }).click();

    await page.getByRole("button", { name: /ACTIVATE FIELD/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Trigger Occurred" }).nth(3).click();
    await page.screenshot({ path: path.join(evidenceDir, "core-03-counter-pending.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Resolve Now", exact: true }).click();
    await page.waitForTimeout(1_300);
    await expect(page.getByLabel("Counters on Anim Pakal, Thousandth Moon")).toContainText("+1/+1");
    await page.screenshot({ path: path.join(evidenceDir, "core-04-counter-result.png"), fullPage: true });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();

    await page.getByRole("button", { name: "Switch to Ability Focus" }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(evidenceDir, "core-05-ability-focus.png"), fullPage: true });
    await page.getByRole("button", { name: "Inspect activated abilities on Life Relic" }).click();
    await expect(page.getByText("Activate only once each turn.", { exact: false })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "core-06-ability-inspection.png"), fullPage: true });
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await page.getByRole("button", { name: "Commit Activation" }).click();
    await page.getByRole("button", { name: "Resolve Now", exact: true }).click();
    await page.waitForTimeout(1_200);
    await expect(page.locator(".life-total strong")).toHaveText("45");
    await page.screenshot({ path: path.join(evidenceDir, "core-07-ability-result.png"), fullPage: true });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: /^Undo/ }).first().click();
    await page.waitForTimeout(900);
    await expect(page.locator(".life-total strong")).toHaveText("42");
    await page.screenshot({ path: path.join(evidenceDir, "core-08-undo.png"), fullPage: true });
  });
});

test("capture verified dungeon and initiative pass", async ({ browser }) => {
  test.setTimeout(90_000);
  const field = createReferenceFixtureField();
  field.id = "boardstate-lite-marketing-dungeon";
  field.name = "BoardState Lite Marketing Dungeon";
  await captureContext(browser, "dungeon-initiative-pass", field, async (page) => {
    await page.getByRole("button", { name: "User Tools", exact: true }).click();
    await page.getByRole("button", { name: /Dungeons & Initiative/ }).click();
    await page.getByRole("button", { name: "Take Initiative", exact: true }).click();
    await page.getByRole("button", { name: /^Secret Entrance, available destination/ }).click();
    await page.screenshot({ path: path.join(evidenceDir, "dungeon-01-initiative-path.png"), fullPage: true });
    await expect(page.locator(".dungeon-position")).toContainText("Secret Entrance");
  });
});

async function captureContext(
  browser: Browser,
  name: string,
  field: ReturnType<typeof createReferenceFixtureField>,
  action: (page: Page) => Promise<void>,
) {
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir: rawDir, size: { width: 430, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const video = page.video();
  await page.addInitScript((initial) => {
    localStorage.setItem("baord-state-lite:last-field-id", initial.id);
    localStorage.setItem(
      "baord-state-lite:last-field-fallback",
      JSON.stringify(initial),
    );
  }, field);
  await page.goto("http://127.0.0.1:4174/", { waitUntil: "commit", timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1_200);
  const continueButton = page.getByRole("button", { name: "Continue to Field" });
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await action(page);
  await context.close();
  const source = await video?.path();
  if (source) await fs.copyFile(source, path.join(rawDir, `${name}.webm`));
}
