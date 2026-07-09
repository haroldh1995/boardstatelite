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

test("startup warning, player counters, and settings persist across reloads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
  await page.getByRole("button", { name: /poison: 0/i }).click();
  await page.getByRole("spinbutton", { name: "poison" }).fill("3");
  await page.mouse.click(4, 4);
  await page.getByRole("button", { name: /^Tools$/ }).click();
  await page.getByLabel("Reduced-motion mode").check();
  await page.mouse.click(4, 4);

  await page.reload();

  await expect(
    page.getByText("Only add cards whose abilities should be tracked"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /poison: 3/i })).toBeVisible();
  await expect(page.locator(".app-shell.reduced-motion")).toBeVisible();
});

test("rules-learning tutorial remains available from Tools", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
  await page.getByRole("button", { name: /^Tools$/ }).click();
  await page
    .getByRole("button", { name: "Open Rules-Learning Tutorial" })
    .click();

  await expect(page.getByRole("dialog")).toContainText(
    "Rules-Learning Tutorial",
  );
  await expect(page.getByRole("dialog")).toContainText("Activate Field");
  await page.getByRole("button", { name: "Return to Field" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
});

test("Activate Field resolves the reference Anim Pakal chain and undo restores it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  await page.goto("/?fixture=reference", { waitUntil: "load" });
  const anim = page.locator('article[aria-label^="Anim Pakal"]').first();
  const before = await anim.getAttribute("aria-label");

  await page.getByRole("button", { name: /ACTIVATE FIELD/ }).click();

  await expect(page.getByRole("dialog")).toContainText("Field Activated");
  await expect(page.getByRole("dialog")).toContainText("Cathars' Crusade");
  await expect(page.getByLabel(/Gnome, stack size/)).toBeVisible();
  await page.getByRole("button", { name: /^Undo$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(anim).toHaveAttribute("aria-label", before ?? "");
});

test("Scryfall search loads a real card image and adds the selected printing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
  await page.getByRole("button", { name: /^Add$/ }).click();
  await page.getByPlaceholder("Search Scryfall cards").fill("sol ring");
  await page
    .getByRole("button", { name: /Sol Ring/i })
    .first()
    .click();
  const preview = page.locator(".card-preview-pane .preview-card-image");
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() =>
      preview.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Add Tracked Card" }).click();
  await expect(page.locator('article[aria-label^="Sol Ring"]')).toBeVisible();
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
