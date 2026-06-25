import { expect, type Locator, type Page, test } from "@playwright/test";

const screenshotOptions = {
  animations: "disabled" as const,
  maxDiffPixelRatio: 0.04,
  timeout: 15_000,
};

test.describe("reference visual fixture", () => {
  test("full reference-style field at 430px", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page).toHaveScreenshot("reference-field-430.png", {
      ...screenshotOptions,
      fullPage: true,
    });
  });

  test("life tracker close-up", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.locator(".life-panel")).toHaveScreenshot(
      "life-tracker.png",
      screenshotOptions,
    );
  });

  test("relevant totals strip", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.locator(".totals-strip")).toHaveScreenshot(
      "totals-strip.png",
      screenshotOptions,
    );
  });

  test("creature section", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.getByTestId("creatures-section")).toHaveScreenshot(
      "creatures-section.png",
      screenshotOptions,
    );
  });

  test("other permanents section", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.getByTestId("other-section")).toHaveScreenshot(
      "other-permanents-section.png",
      screenshotOptions,
    );
  });

  test("attachments section", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.getByTestId("attachments-section")).toHaveScreenshot(
      "attachments-section.png",
      screenshotOptions,
    );
  });

  test("generics and tokens section", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.getByTestId("token-section")).toHaveScreenshot(
      "generics-tokens-section.png",
      screenshotOptions,
    );
  });

  test("bottom control dock", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await expect(page.locator(".bottom-dock")).toHaveScreenshot(
      "bottom-dock.png",
      screenshotOptions,
    );
  });

  test("narrow mobile layout", async ({ page }) => {
    await openReferenceFixture(page, 320, 960);
    await expect(page).toHaveScreenshot("reference-field-320.png", {
      ...screenshotOptions,
      fullPage: true,
    });
  });

  test("tablet portrait layout", async ({ page }) => {
    await openReferenceFixture(page, 768, 1024);
    await expect(page).toHaveScreenshot("reference-field-tablet.png", {
      ...screenshotOptions,
      fullPage: true,
    });
  });

  test("desktop layout", async ({ page }) => {
    await openReferenceFixture(page, 1280, 900);
    await expect(page).toHaveScreenshot("reference-field-desktop.png", {
      ...screenshotOptions,
      fullPage: true,
    });
  });

  test("long-press permanent menu", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await longPress(page, page.locator('article[aria-label^="Anim Pakal"]'));
    await expect(page.getByRole("dialog")).toHaveScreenshot(
      "long-press-permanent-menu.png",
      screenshotOptions,
    );
  });

  test("Scryfall search modal", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await page.getByRole("button", { name: /^Add$/ }).click();
    await expect(page.getByRole("dialog")).toHaveScreenshot(
      "scryfall-search-modal.png",
      screenshotOptions,
    );
  });

  test("stack-removal modal", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await page.locator('article[aria-label^="Saproling"]').dblclick();
    await expect(page.getByRole("dialog")).toHaveScreenshot(
      "stack-removal-modal.png",
      screenshotOptions,
    );
  });

  test("Transform All modal", async ({ page }) => {
    await openReferenceFixture(page, 430, 1280);
    await longPress(page, page.getByRole("button", { name: /ACTIVATE FIELD/ }));
    await expect(page.getByRole("dialog")).toHaveScreenshot(
      "transform-all-modal.png",
      screenshotOptions,
    );
  });
});

async function openReferenceFixture(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?fixture=reference", { waitUntil: "load" });
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.getByTestId("creatures-section")).toBeVisible();
  await page.waitForFunction(
    () =>
      [...document.images].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    undefined,
    { timeout: 45_000 },
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function longPress(page: Page, locator: Locator) {
  await expect(locator).toHaveCount(1);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box)
    throw new Error("Cannot long-press element without a bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}
