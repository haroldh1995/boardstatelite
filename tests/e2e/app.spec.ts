import { expect, test } from "@playwright/test";

const widths = [320, 375, 390, 430, 768, 1280];

for (const width of widths) {
  test(`core field flow is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 760 });
    await page.goto("/");

    await continuePastStartup(page);

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

test("pre-turn planner creates editable plans without mutating the battlefield", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/");
  await continuePastStartup(page);
  await expect(
    page.getByRole("button", { name: /40 tap to set life total/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Tools$/ }).click();
  await page.getByRole("button", { name: /Open Pre-Turn Planner/i }).click();
  await expect(
    page.getByRole("heading", { name: /One-Minute Pre-Turn Planner/i }),
  ).toBeVisible();

  await page.getByLabel("Action type").selectOption("spell-sequence");
  await page.getByLabel("Plan title").fill("Cast Sol Ring");
  await page
    .getByRole("textbox", { name: "Reminder" })
    .fill("Cast before combat");
  await page.getByRole("textbox", { name: "Notes" }).fill("Use floating mana.");
  await page.getByRole("button", { name: "Add Planned Action" }).click();

  await expect(
    page.getByRole("listitem", { name: /Cast Sol Ring, planned/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /40 tap to set life total/i }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Mark Cast Sol Ring complete/i })
    .click();
  await expect(
    page.getByRole("listitem", { name: /Cast Sol Ring, completed/i }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: /Active turn action strip/i }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Begin Turn/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /^Draw/ }).first(),
  ).toBeVisible();
});

test("voice settings remain opt-in and do not expose unfinished controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/");
  await continuePastStartup(page);

  await page.getByRole("button", { name: /^Tools$/ }).click();
  await expect(
    page.getByRole("heading", { name: /Voice & Microphone/i }),
  ).toBeVisible();
  await expect(page.getByLabel(/Enable Voice Features/i)).not.toBeChecked();
  await expect(page.getByLabel(/Enable Ambient Listening/i)).toBeDisabled();
  await expect(page.getByLabel(/Push-to-Talk \(future\)/i)).toBeDisabled();
  await expect(page.getByLabel(/Always Listening \(future\)/i)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Microphone Test/i }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Begin Voice Enrollment/i }),
  ).toBeVisible();

  await page.getByLabel(/Enable Voice Features/i).check();
  await expect(page.getByLabel(/Enable Ambient Listening/i)).toBeEnabled();
  await page.getByRole("button", { name: /Begin Voice Enrollment/i }).click();
  await expect(page.getByText(/Play a Forest/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Record Current Sample/i }),
  ).toBeVisible();
});

async function continuePastStartup(page: import("@playwright/test").Page) {
  const startupDialog = page.getByRole("dialog", {
    name: /Only add cards whose abilities should be tracked/i,
  });
  try {
    await startupDialog.waitFor({ state: "visible", timeout: 3_000 });
    await page.mouse.click(4, 4);
    await expect(startupDialog).toBeVisible();
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
