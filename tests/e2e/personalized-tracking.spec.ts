import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to Field" }).click();
}
async function expandLife(page: Page) {
  const accessible = page.getByRole("button", {
    name: "Expand Life Tracker",
    exact: true,
  });
  await accessible.focus();
  await accessible.press("Enter");
}
async function close(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).click();
}
async function openDungeons(page: Page) {
  await page.getByRole("button", { name: "User Tools", exact: true }).click();
  await page.getByRole("button", { name: /Dungeons & Initiative/ }).click();
}

test("personalized counters preserve values, save layouts, survive restart and reset only game values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expandLife(page);
  for (let i = 0; i < 6; i++)
    await page
      .getByRole("button", { name: "Increase Poison", exact: true })
      .click();
  await expect(
    page.getByRole("group", { name: "Poison", exact: true }).locator("strong"),
  ).toHaveText("6");
  await expect(page.locator(".player-tracker-area .numeric-delta")).toHaveText(
    "+6",
  );
  await page.getByRole("button", { name: "Customize player counters" }).click();
  await page.getByRole("button", { name: "Hide Poison", exact: true }).click();
  await close(page);
  await expect(
    page.getByRole("group", { name: "Poison", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Customize player counters" }).click();
  await page.getByLabel("Add counter tracker").selectOption("poison");
  await page.getByLabel("Custom counter name").fill("Quest");
  await page.getByRole("button", { name: "Add custom counter" }).click();
  await page.getByLabel("Rename Quest").fill("My Progress");
  await page.getByLabel("Rename Quest").press("Tab");
  await page.getByRole("button", { name: "Move My Progress up" }).click();
  await page.getByLabel("Layout name").fill("My Game");
  await page.getByRole("button", { name: "Save Layout", exact: true }).click();
  await page.getByRole("button", { name: "Restore Default Layout" }).click();
  await page
    .getByLabel("Choose counter layout")
    .selectOption({ label: "My Game" });
  await close(page);
  await expect(
    page.getByRole("group", { name: "Poison", exact: true }).locator("strong"),
  ).toHaveText("6");
  await expect(
    page
      .locator(".player-tracker-grid .numeric-adjuster > span:first-child")
      .first(),
  ).toHaveText("My Progress");
  await page.getByRole("button", { name: "Increase My Progress" }).click();
  await page.getByRole("button", { name: "Customize player counters" }).click();
  await close(page);
  await page.reload();
  await page.getByRole("button", { name: "Continue to Field" }).click();
  await expandLife(page);
  await expect(
    page
      .getByRole("group", { name: "My Progress", exact: true })
      .locator("strong"),
  ).toHaveText("1");
  await page.getByRole("button", { name: "User Tools", exact: true }).click();
  await page.getByRole("button", { name: /New Game Start a fresh/ }).click();
  await page.getByRole("button", { name: "New Game", exact: true }).click();
  await page
    .getByRole("button", { name: "Play Without Deck", exact: true })
    .click();
  await expandLife(page);
  await expect(
    page.getByRole("group", { name: "Poison", exact: true }).locator("strong"),
  ).toHaveText("0");
  await expect(
    page
      .getByRole("group", { name: "My Progress", exact: true })
      .locator("strong"),
  ).toHaveText("0");
});

test("dungeon paths, supported effects, correction and initiative ownership remain separate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await openDungeons(page);
  await page
    .getByRole("button", { name: "Venture into Dungeon", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^Cave Entrance, available destination/ })
    .click();
  await page
    .getByRole("button", { name: "Resolved at Table", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Venture into Dungeon", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Temple of Dumathoin\./ }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: /^Mine Tunnels, available destination/ })
    .click();
  await page.getByRole("button", { name: "Apply Effect", exact: true }).click();
  await page
    .getByRole("button", { name: "Venture into Dungeon", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^Dark Pool, available destination/ })
    .click();
  await page.getByRole("button", { name: "Apply Effect", exact: true }).click();
  await page
    .getByRole("button", { name: "Take Initiative", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Lost Mine of Phandelver", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /^Temple of Dumathoin, available destination/,
    })
    .click();
  await expect(page.locator(".dungeon-position")).toContainText(
    "Current room: Temple",
  );
  await page
    .getByRole("button", { name: "Resolved at Table", exact: true })
    .click();
  await expect(page.locator(".dungeon-position")).toContainText(
    "No active dungeon",
  );
  await expect(
    page.getByText("Journey / Completed (1)", { exact: true }),
  ).toBeVisible();
  await page.getByText("Assign / Correct Holder", { exact: true }).click();
  await page.getByLabel("Initiative holder").selectOption("");
  await page.getByText("Correct Position", { exact: true }).click();
  const correction = page.locator(".dungeon-correction");
  await correction
    .getByLabel("Correct dungeon", { exact: true })
    .selectOption({ label: "Undercity" });
  await correction
    .getByLabel("Correct room", { exact: true })
    .selectOption("forge");
  await page.getByRole("button", { name: "Correct Room Only" }).click();
  await expect(page.locator(".dungeon-pending")).toHaveCount(0);
  await close(page);
  await expect(page.locator(".life-total strong")).toHaveText("41");
  await expect(
    page.getByRole("button", { name: /Dungeon.*Forge/ }),
  ).toBeVisible();
});

test("many counters stay expandable without hiding core gameplay controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await ready(page);
  await expandLife(page);
  await page.getByRole("button", { name: "Customize player counters" }).click();
  await page.getByLabel("Choose counter layout").selectOption("standard");
  for (const id of ["rad", "ticket", "acorn"])
    await page.getByLabel("Add counter tracker").selectOption(id);
  await page.screenshot({
    path: "output/playwright/counter-layout-320.png",
    fullPage: true,
  });
  await close(page);
  await expect(page.locator(".full-life-center > strong")).toHaveText("40");
  await expect(
    page.getByRole("button", { name: "Increase Rad", exact: true }),
  ).toBeHidden();
  await page.getByText("More Counters (3)", { exact: true }).click();
  await page.getByRole("button", { name: "Increase Rad", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Rad", exact: true }).locator("strong"),
  ).toHaveText("1");
  await page
    .getByRole("button", { name: "Commander Damage", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Commander Damage", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

for (const width of [320, 768]) {
  test(`counter hold cancellation and dungeon layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 1024 });
    await ready(page);
    await expandLife(page);
    const increase = page.getByRole("button", {
      name: "Increase Poison",
      exact: true,
    });
    const box = await increase.boundingBox();
    if (!box) throw new Error("Counter control missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(850);
    await page.mouse.up();
    const value = await page
      .getByRole("group", { name: "Poison", exact: true })
      .locator("strong")
      .textContent();
    expect(Number(value)).toBeGreaterThan(1);
    await page.waitForTimeout(900);
    await expect(
      page
        .getByRole("group", { name: "Poison", exact: true })
        .locator("strong"),
    ).toHaveText(value!);
    await page.screenshot({
      path: `output/playwright/personalized-life-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: /^Undo:/ }).click();
    await expect(
      page
        .getByRole("group", { name: "Poison", exact: true })
        .locator("strong"),
    ).toHaveText("0");
    await openDungeons(page);
    await page
      .getByRole("button", { name: "Take Initiative", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Secret Entrance, available destination/ })
      .click();
    await page.screenshot({
      path: `output/playwright/dungeon-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
