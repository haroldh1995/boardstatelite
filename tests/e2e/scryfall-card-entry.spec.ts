import { expect, type Page, test } from "@playwright/test";

const card = {
  id: "card-hag",
  oracle_id: "oracle-hag",
  name: "Hag of Noxious Nightmares",
  mana_cost: "{2}{B}",
  cmc: 3,
  type_line: "Creature - Hag Warlock",
  oracle_text: "Warlocks you control have menace.",
  flavor_text: "A nightmare remembered is a nightmare returned.",
  colors: ["B"],
  color_identity: ["B"],
  keywords: [],
  power: "2",
  toughness: "2",
  layout: "normal",
  set: "tst",
  collector_number: "1",
  image_uris: {
    normal:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='488' height='680'%3E%3Crect width='488' height='680' fill='%2315191b'/%3E%3Ctext x='244' y='320' text-anchor='middle' fill='white' font-size='28'%3EHag of Noxious%3C/text%3E%3Ctext x='244' y='360' text-anchor='middle' fill='white' font-size='28'%3ENightmares%3C/text%3E%3C/svg%3E",
    small:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='146' height='204'%3E%3Crect width='146' height='204' fill='%2315191b'/%3E%3C/svg%3E",
    art_crop: "",
  },
};

test.describe("Scryfall card entry handoff", () => {
  for (const width of [320, 390, 430]) {
    test(`search and preview fit ${width}px without horizontal overflow`, async ({
      page,
    }) => {
      await openPicker(page, width);
      await page.getByPlaceholder("Search Scryfall cards").fill("Noxious");
      await page
        .getByRole("option", { name: /Hag of Noxious Nightmares/i })
        .click();

      await expect(
        page.getByAltText("Hag of Noxious Nightmares card"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Cast selected card." }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Put selected card onto the battlefield without casting it.",
        }),
      ).toBeVisible();
      await expect(page.getByRole("listbox")).toHaveCount(0);
      const contract = await page.locator(".modal-sheet").evaluate((sheet) => {
        const cast = sheet.querySelector<HTMLButtonElement>(
          'button[aria-label="Cast selected card."]',
        );
        const add = sheet.querySelector<HTMLButtonElement>(
          'button[aria-label^="Put selected card"]',
        );
        const bounds = sheet.getBoundingClientRect();
        return {
          sheetFits: sheet.scrollWidth <= sheet.clientWidth,
          documentFits:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
          castFits:
            Boolean(cast) &&
            cast!.getBoundingClientRect().left >= bounds.left &&
            cast!.getBoundingClientRect().right <= bounds.right,
          addFits:
            Boolean(add) &&
            add!.getBoundingClientRect().left >= bounds.left &&
            add!.getBoundingClientRect().right <= bounds.right,
        };
      });
      expect(contract).toEqual({
        sheetFits: true,
        documentFits: true,
        castFits: true,
        addFits: true,
      });
      if (width === 390) {
        await expect(page.getByRole("dialog")).toHaveScreenshot(
          "scryfall-preview-390.png",
          { animations: "disabled", maxDiffPixelRatio: 0.04 },
        );
      }

      await page.getByPlaceholder("Search Scryfall cards").click();
      await expect(page.getByRole("listbox")).toBeVisible();
    });
  }

  test("ADD commits entry semantics from the shared preview", async ({
    page,
  }) => {
    await openPicker(page, 390);
    await page.getByPlaceholder("Search Scryfall cards").fill("Noxious");
    await page
      .getByRole("option", { name: /Hag of Noxious Nightmares/i })
      .click();
    await page
      .getByRole("button", {
        name: "Put selected card onto the battlefield without casting it.",
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.locator('article[aria-label^="Hag of Noxious Nightmares"]'),
    ).toHaveCount(1);
  });
});

async function openPicker(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.route("https://api.scryfall.com/cards/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [card], has_more: false }),
    });
  });
  await page.goto("/?fixture=reference", { waitUntil: "load" });
  await page.getByRole("button", { name: /^Add$/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
