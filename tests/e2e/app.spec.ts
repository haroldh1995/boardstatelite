import { expect, test } from "@playwright/test";

const widths = [320, 375, 390, 430, 768, 1280];

for (const width of widths) {
  test(`core field flow is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 760 });
    await page.goto("/");

    await expect(
      page.getByText("Only add cards whose abilities should be tracked"),
    ).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(
      page.getByText("Only add cards whose abilities should be tracked"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Continue to Field" }).click();
    await expect(
      page.getByRole("button", { name: /40 tap to set life total/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /activate field/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Add$/ }).click();
    await page.getByRole("button", { name: "Generic Placeholder" }).click();
    await page.getByLabel("Label").fill(`E2E Creature ${width}`);
    await page.getByLabel("Quantity").fill("2");
    await page.getByRole("button", { name: "Add Placeholder" }).click();

    await expect(
      page.getByLabel(`E2E Creature ${width}, stack size 2`),
    ).toBeVisible();
    await page.getByRole("button", { name: /gain 1 life/i }).click();
    await expect(
      page.getByRole("button", { name: /41 tap to set life total/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /expand life controls/i }).click();
    await page.getByRole("button", { name: /^Undo$/ }).click();
    await expect(
      page.getByRole("button", { name: /40 tap to set life total/i }),
    ).toBeVisible();
  });
}

test("not-tracked card state can be stopped and resumed from the permanent menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/?fixture=reference", { waitUntil: "load" });
  const anim = page.locator('article[aria-label^="Anim Pakal"]').first();

  await longPress(page, anim);
  await page.getByRole("button", { name: "Stop Tracking Card" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "This card will remain on your battlefield",
  );
  await page.mouse.click(4, 4);
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(anim).not.toHaveAttribute("aria-label", /Not Tracked/);

  await longPress(page, anim);
  await page.getByRole("button", { name: "Stop Tracking Card" }).click();
  await page.getByRole("button", { name: "Stop Tracking" }).click();
  await expect(anim).toHaveAttribute("aria-label", /Not Tracked/);
  await expect(anim.locator(".tracking-badge")).toBeVisible();

  await page.getByRole("button", { name: /ACTIVATE FIELD/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "No supported active abilities resolved",
  );
  await page
    .locator(".modal-actions")
    .getByRole("button", { name: "Close" })
    .click();

  await longPress(page, anim);
  await page.getByRole("button", { name: "Resume Tracking Card" }).click();
  await page.getByRole("button", { name: "Resume Tracking" }).click();
  await expect(anim).not.toHaveAttribute("aria-label", /Not Tracked/);

  await page.getByRole("button", { name: /ACTIVATE FIELD/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Anim Pakal");
});

async function longPress(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator,
) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box)
    throw new Error("Cannot long-press element without a bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}
