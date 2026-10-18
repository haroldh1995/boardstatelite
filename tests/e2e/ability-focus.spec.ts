import { test, expect } from "@playwright/test";
import { createDefaultField } from "../../src/domain/field";
import { createCardGroup } from "../../src/domain/cards";
import { testCard } from "../../src/test/factories";

test("ability focus, costs, pending recovery and offline resolution on a small phone", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const field = createDefaultField();
  field.groups = [
    createCardGroup(
      testCard({
        name: "Life Relic",
        typeLine: "Artifact",
        oracleText: "{T}: You gain 3 life. Activate only once each turn.",
      }),
    ),
  ];
  await page.addInitScript((initial) => {
    if (!localStorage.getItem("baord-state-lite:last-field-id")) {
      localStorage.setItem("baord-state-lite:last-field-id", initial.id);
      localStorage.setItem(
        "baord-state-lite:last-field-fallback",
        JSON.stringify(initial),
      );
    }
  }, field);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
  await expect(page.getByLabel("Turn phase")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to Ability Focus" }).click();
  await expect(page.locator(".ability-focus-available")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Inspect activated abilities on Life Relic" })
    .click();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await page.getByRole("button", { name: "Commit Activation" }).click();
  await expect(
    page.getByText("Pending resolution", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/playwright/ability-pending-320.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  const continueButton = page.getByRole("button", {
    name: "Continue to Field",
  });
  if (await continueButton.isVisible()) await continueButton.click();
  await context.setOffline(true);
  await page.getByRole("button", { name: /Turn Memory\. / }).click();
  await page.getByRole("button", { name: "Review Ability" }).click();
  await page.getByRole("button", { name: "Resolve Now" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".life-total strong")).toHaveText("43");
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await expect(page.locator(".life-total strong")).toHaveText("40");
  await context.setOffline(false);
  await page.getByRole("button", { name: "User Tools", exact: true }).click();
  await page.getByRole("button", { name: /Game Activity/ }).click();
  await expect(
    page.getByRole("heading", { name: "Game Activity" }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/playwright/ability-activity-320.png",
    fullPage: true,
  });
});

test("swipe and keyboard alternatives change presentation, not gameplay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
  const activation = page.locator(".activate-button");
  const box = await activation.boundingBox();
  if (!box) throw new Error("Activation control missing");
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(activation).toContainText("ABILITY FOCUS");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".life-total strong")).toHaveText("40");
  await page.getByRole("button", { name: "Switch to Activate Field" }).focus();
  await page.keyboard.press("Enter");
  await expect(activation).toContainText("ACTIVATE FIELD");
  await page.screenshot({
    path: "output/playwright/ability-dock-390.png",
    fullPage: true,
  });
});

test("multi-target choices stay editable until the player commits them", async ({
  page,
}) => {
  const field = createDefaultField();
  field.groups = [
    createCardGroup(
      testCard({
        name: "Counter Engine",
        typeLine: "Artifact",
        oracleText: "{T}: Put a +1/+1 counter on up to two target creatures.",
      }),
    ),
    createCardGroup(
      testCard({ name: "Alpha", typeLine: "Creature", oracleText: "" }),
    ),
    createCardGroup(
      testCard({ name: "Beta", typeLine: "Creature", oracleText: "" }),
    ),
  ];
  await page.addInitScript((initial) => {
    localStorage.setItem("baord-state-lite:last-field-id", initial.id);
    localStorage.setItem(
      "baord-state-lite:last-field-fallback",
      JSON.stringify(initial),
    );
  }, field);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
  await page.getByRole("button", { name: "Switch to Ability Focus" }).click();
  await page
    .getByRole("button", {
      name: "Inspect activated abilities on Counter Engine",
    })
    .click();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Alpha" }).check();
  await expect(dialog.getByRole("checkbox", { name: "Beta" })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Beta" }).check();
  await page.getByRole("button", { name: "Use Selection" }).click();
  await page.getByRole("button", { name: "Commit Activation" }).click();
  await page.getByRole("button", { name: "Resolve Now" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
});
