import { expect, type Locator, type Page, test } from "@playwright/test";

test("permanent management removes an exact counter amount and all remaining counters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=reference", { waitUntil: "load" });
  const anim = page.locator('article[aria-label^="Anim Pakal"]').first();

  await longPress(page, anim);
  const counterQuantity = page.getByLabel("+1/+1 counter quantity");
  await expect(counterQuantity.getByText("8", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove one +1/+1 counter" }).click();
  await expect(counterQuantity.getByText("7", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Advanced / Correct Card State" })
    .click();
  await expect(page.getByText("+1/+1: 7", { exact: true })).toBeVisible();
  await page.getByLabel("Amount", { exact: true }).fill("3");
  await page
    .getByRole("button", {
      name: "Remove 3 +1/+1 counters from Anim Pakal, Thousandth Moon",
    })
    .click();
  await expect(anim).toHaveAttribute(
    "aria-label",
    /current power 7 and toughness 8/i,
  );

  await longPress(page, anim);
  await expect(
    page.getByLabel("+1/+1 counter quantity").getByText("4", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Advanced / Correct Card State" })
    .click();
  await expect(page.getByText("+1/+1: 4", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove all +1/+1 counters from Anim Pakal, Thousandth Moon",
    })
    .click();
  await expect(anim).toHaveAttribute(
    "aria-label",
    /current power 3 and toughness 4/i,
  );
});

test("land-play status is visible, manually correctable, and reminder assistance is opt-in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await continuePastStartup(page);

  const pendingLand = page.getByRole("button", {
    name: /Lands: \d+\. Land play: not marked this turn/i,
  });
  await expect(pendingLand).toBeVisible();
  await pendingLand.click();
  await page.getByRole("button", { name: "Mark Land Played" }).click();
  const completedLand = page.getByRole("button", {
    name: /Lands: \d+\. Land play: marked complete/i,
  });
  await expect(completedLand).toBeVisible();

  await completedLand.click();
  await page.getByRole("button", { name: "Mark One Not Played" }).click();
  await expect(pendingLand).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Gameplay Reminders").check();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^User Tools$/ }).click();
  await page.getByRole("button", { name: /Plan Next Turn/i }).click();
  await page.getByLabel("Plan title").fill("Reminder check");
  await page.getByRole("button", { name: "Add Planned Action" }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Begin Turn/ })
    .first()
    .click();
  await expect(page.getByTestId("gameplay-reminder")).toContainText(
    "Land play not marked yet.",
  );

  await page
    .getByTestId("gameplay-reminder")
    .getByRole("button", { name: "Update" })
    .click();
  await page.getByRole("button", { name: "Mark Land Played" }).click();
  await expect(page.getByTestId("gameplay-reminder")).toHaveCount(0);

  await page.reload();
  await continuePastStartup(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("Gameplay Reminders")).toBeChecked();
});

async function continuePastStartup(page: Page) {
  const startupDialog = page.getByRole("dialog", {
    name: /Only add cards whose abilities should be tracked/i,
  });
  try {
    await startupDialog.waitFor({ state: "visible", timeout: 3_000 });
    await startupDialog
      .getByRole("button", { name: "Continue to Field" })
      .click();
  } catch {
    const continueButton = page.getByRole("button", {
      name: "Continue to Field",
    });
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
    }
  }
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
}

async function longPress(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Permanent was not available for long press.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
}
