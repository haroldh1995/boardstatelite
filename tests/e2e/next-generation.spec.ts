import { expect, type Page, test } from "@playwright/test";

test("turn context and full-screen life remain fast at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await continuePastStartup(page);

  await page.getByRole("button", { name: "Start Turn" }).click();
  await page.getByRole("button", { name: "Combat" }).click();
  await expect(page.getByRole("button", { name: "Combat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Open full-screen life" }).click();
  await expect(
    page.getByRole("main", { name: "Full-screen life mode" }),
  ).toBeVisible();
  await expect(page.getByText("40", { exact: true })).toBeVisible();
  const loseLife = page.getByRole("button", {
    name: /Lose life. Press and hold/i,
  });
  const gainLife = page.getByRole("button", {
    name: /Gain life. Press and hold/i,
  });
  for (let index = 0; index < 5; index += 1) await loseLife.click();
  await expect(page.getByText("35", { exact: true })).toBeVisible();
  await expect(page.getByText("-5", { exact: true })).toBeVisible();
  await gainLife.click();
  await gainLife.click();
  await expect(page.getByText("37", { exact: true })).toBeVisible();
  await expect(page.getByText("-3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to battlefield" }).click();
  await expect(
    page.getByRole("button", { name: /37 tap to set life total/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand life controls" }).click();
  await page.getByRole("button", { name: /^Undo$/ }).click();
  await expect(
    page.getByRole("button", { name: /40 tap to set life total/i }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Options and User Tools are separate and randomizers publish one result", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await continuePastStartup(page);

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("heading", { name: "Options" })).toBeVisible();
  await expect(page.getByText("Static Effects", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "User Tools" }).click();
  await expect(page.getByRole("heading", { name: "User Tools" })).toBeVisible();
  await page.getByRole("button", { name: /Dice/i }).click();
  await page.getByLabel("Number").fill("2");
  await page.getByLabel("Sides").selectOption("6");
  await page.getByRole("button", { name: "Roll" }).click();
  await expect(page.locator(".randomizer-stage strong")).toContainText("Total");
  await expectNoHorizontalOverflow(page);
});

test("commander damage and manual static effects use direct canonical tools", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/?fixture=reference", { waitUntil: "load" });

  await page.getByRole("button", { name: /CMD Damage: 0/i }).click();
  await page.getByRole("textbox", { name: "Player", exact: true }).fill("Alex");
  await page
    .getByRole("textbox", { name: "Commander", exact: true })
    .fill("Partner One");
  await page.getByRole("button", { name: "Add Commander" }).click();
  await page
    .getByRole("button", { name: "Increase damage from Partner One" })
    .click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(
    page.getByRole("button", { name: /39 tap to set life total/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: "User Tools" }).click();
  await page.getByRole("button", { name: /Static Effects/i }).click();
  await page.getByRole("button", { name: "Add Effect" }).click();
  await expect(page.getByText(/Source:/).first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".effect-source-badge").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

async function continuePastStartup(page: Page) {
  const startup = page.getByRole("dialog", {
    name: /Only add cards whose abilities should be tracked/i,
  });
  try {
    await startup.waitFor({ state: "visible", timeout: 3_000 });
    await startup.getByRole("button", { name: "Continue to Field" }).click();
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

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
