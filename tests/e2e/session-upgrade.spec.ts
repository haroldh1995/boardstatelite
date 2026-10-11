import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
}
async function pinch(page: Page, from: number, to: number) {
  await page.locator(".app-shell").evaluate(
    (element, values) => {
      const touches = (width: number) => [
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

test("global pinch is presentation-only and blocked by modal surfaces", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await pinch(page, 100, 140);
  await expect(
    page.getByRole("main", { name: "Full-screen life mode" }),
  ).toBeVisible();
  await expect(page.locator(".full-life-center > strong")).toHaveText("40");
  await page.screenshot({
    path: "output/playwright/full-screen-life-phone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await pinch(page, 140, 90);
  await expect(
    page.getByRole("main", { name: "Full-screen life mode" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await pinch(page, 140, 90);
  await expect(
    page.getByRole("main", { name: "Full-screen life mode" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /40 tap to set life total/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Turn", exact: true }),
  ).toBeVisible();
});

test("touch release and interruption stop the originating hold immediately", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await ready(page);
  const input = await context.newCDPSession(page);
  try {
    for (const termination of ["touchEnd", "touchCancel"]) {
      const box = await page
        .getByRole("button", { name: "Lose 1 life", exact: true })
        .boundingBox();
      if (!box) throw new Error("Life control missing");
      await input.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
        ],
      });
      await page.waitForTimeout(800);
      await input.send("Input.dispatchTouchEvent", {
        type: termination,
        touchPoints: [],
      });
      const released = await page.locator(".life-total strong").textContent();
      expect(Number(released)).toBeLessThan(39);
      await page.waitForTimeout(900);
      await expect(page.locator(".life-total strong")).toHaveText(released!);
      await page.getByRole("button", { name: /^Undo:/ }).tap();
      await expect(page.locator(".life-total strong")).toHaveText("40");
    }
  } finally {
    await context.close();
  }
});

test("release and modal interruption cannot leave a life repeat running", async ({
  page,
}) => {
  await ready(page);
  const button = page.getByRole("button", { name: "Lose 1 life", exact: true });
  const box = await button.boundingBox();
  if (!box) throw new Error("Life control missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  const after = await page.locator(".life-total strong").textContent();
  await page.waitForTimeout(900);
  await expect(page.locator(".life-total strong")).toHaveText(after!);
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await expect(page.locator(".life-total strong")).toHaveText("40");
});

test("new game empties land counts, preserves Options and restores standard presentation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await ready(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Gameplay Reminders").check();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await pinch(page, 100, 140);
  await page.getByRole("button", { name: "User Tools", exact: true }).click();
  await page.getByRole("button", { name: /New Game Start a fresh/ }).click();
  await page.getByRole("button", { name: "New Game", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Current Deck", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Play Without Deck", exact: true })
    .click();
  await expect(page.locator(".life-total strong")).toHaveText("40");
  const land = page.getByRole("button", {
    name: /Battlefield lands: 0. Basic 0. Nonbasic 0/,
  });
  await expect(land).toBeVisible();
  await land.dispatchEvent("pointerdown", { pointerId: 1, button: 0 });
  await expect(land.locator(".land-breakdown")).toHaveText(
    "Basic 0 / Nonbasic 0",
  );
  await land.dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(land.locator(".land-breakdown")).toBeEmpty();
  await page.getByRole("button", { name: "User Tools", exact: true }).click();
  await page
    .getByRole("button", { name: /Battlefield Counts Inspect/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Battlefield Counts", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/playwright/battlefield-counts-tablet.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("Gameplay Reminders")).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
