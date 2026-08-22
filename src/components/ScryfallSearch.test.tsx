import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCard } from "../test/factories";
import { ScryfallSearch } from "./ScryfallSearch";

const pageOne = [
  testCard({
    cardId: "hag-one",
    oracleId: "hag-oracle",
    name: "Hag of Noxious Nightmares",
    typeLine: "Creature - Hag Warlock",
    oracleText: "Warlocks you control have menace.",
    imageUrl: "https://cards.example/hag.jpg",
    imageSmall: "https://cards.example/hag-small.jpg",
  }),
  testCard({
    cardId: "hag-printing-two",
    oracleId: "hag-oracle",
    name: "Hag of Noxious Nightmares",
    typeLine: "Creature - Hag Warlock",
    oracleText: "Warlocks you control have menace.",
  }),
  testCard({
    cardId: "assault",
    oracleId: "assault-oracle",
    name: "Noxious Assault",
    typeLine: "Sorcery",
    oracleText: "Creatures you control get +2/+2.",
  }),
];

const { searchPageMock } = vi.hoisted(() => ({ searchPageMock: vi.fn() }));

vi.mock("../services/scryfall", () => ({
  rankScryfallResults: (_query: string, cards: unknown[]) => cards,
  searchScryfallPage: searchPageMock,
}));

describe("shared Scryfall search and preview", () => {
  beforeEach(() => {
    searchPageMock.mockImplementation(
      (_query: string, options: { pageUrl?: string | null }) =>
        Promise.resolve(
          options.pageUrl
            ? {
                cards: [
                  testCard({
                    cardId: "dragon",
                    oracleId: "dragon-oracle",
                    name: "Noxious Dragon",
                    typeLine: "Creature - Dragon",
                    oracleText: "Flying",
                  }),
                ],
                nextPage: null,
                fromCache: false,
              }
            : {
                cards: pageOne,
                nextPage: "https://api.scryfall.com/page/2",
                fromCache: false,
              },
        ),
    );
  });

  afterEach(cleanup);

  it("uses full-width search and preview states with explicit CAST and ADD", async () => {
    const user = userEvent.setup();
    const cast = vi.fn();
    const add = vi.fn();
    render(
      <ScryfallSearch
        label="Choose a card"
        actions={[
          {
            id: "cast",
            label: "CAST",
            semanticLabel: "Cast selected card.",
            onConfirm: cast,
          },
          {
            id: "add",
            label: "ADD",
            semanticLabel:
              "Put selected card onto the battlefield without casting it.",
            onConfirm: add,
          },
        ]}
      />,
    );
    const search = screen.getByPlaceholderText("Search Scryfall cards");
    await user.type(search, "Noxious");
    expect(
      await screen.findByRole("option", {
        name: /Hag of Noxious Nightmares/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Hag of Noxious Nightmares")).toHaveLength(1);

    await user.click(
      screen.getByRole("option", { name: /Hag of Noxious Nightmares/i }),
    );
    expect(
      screen.queryByRole("listbox", { name: "Scryfall search results" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByAltText(/Hag of Noxious Nightmares card/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Cast selected card." }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Put selected card onto the battlefield without casting it.",
      }),
    ).toBeVisible();

    await user.click(search);
    expect(
      screen.getByRole("listbox", { name: "Scryfall search results" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Noxious Assault")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more cards" }));
    expect(await screen.findByText("Noxious Dragon")).toBeInTheDocument();

    await user.click(
      screen.getByRole("option", { name: /Hag of Noxious Nightmares/i }),
    );
    await user.click(
      screen.getByRole("button", { name: "Cast selected card." }),
    );
    await waitFor(() => expect(cast).toHaveBeenCalledTimes(1));
  });

  it("clears the query and starts a fresh search from preview mode", async () => {
    const user = userEvent.setup();
    render(
      <ScryfallSearch
        label="Choose a card"
        actionLabel="Use This Card"
        onConfirm={() => undefined}
      />,
    );
    const search = screen.getByPlaceholderText("Search Scryfall cards");
    await user.type(search, "Noxious");
    await user.click(
      await screen.findByRole("option", {
        name: /Hag of Noxious Nightmares/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Clear card search" }));
    expect(search).toHaveValue("");
    expect(
      screen.getByRole("listbox", { name: "Scryfall search results" }),
    ).toBeInTheDocument();
  });
});
