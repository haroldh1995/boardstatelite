import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { createDefaultField } from "./domain/field";
import { useFieldStore } from "./state/useFieldStore";

describe("Baord State Lite app shell", () => {
  beforeEach(() => {
    localStorage.clear();
    useFieldStore.setState({
      field: createDefaultField(),
      hydrated: false,
      startupVisible: true,
      modal: { kind: "startup" },
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a blocking startup warning that cannot be dismissed by outside tap", async () => {
    const { container } = render(<App />);

    expect(
      await screen.findByText(
        "Only add cards whose abilities should be tracked",
      ),
    ).toBeInTheDocument();
    const overlay = container.querySelector(".modal-overlay");
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay!);

    expect(
      screen.getByText("Only add cards whose abilities should be tracked"),
    ).toBeInTheDocument();
  });

  it("continues to the field and supports life increment plus undo", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /gain 1 life/i }));

    expect(
      screen.getByRole("button", { name: /41 tap to set life total/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /expand life controls/i }),
    );
    await user.click(screen.getByRole("button", { name: /^undo$/i }));
    expect(
      screen.getByRole("button", { name: /40 tap to set life total/i }),
    ).toBeInTheDocument();
  });

  it("closes non-blocking popups on outside tap without applying changes or click-through", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByText("Add to Field")).toBeInTheDocument();

    const overlay = container.querySelector(".modal-overlay");
    fireEvent.pointerDown(overlay!);

    await waitFor(() =>
      expect(screen.queryByText("Add to Field")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Search Scryfall cards")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /activate field/i }),
    ).toBeInTheDocument();
  });
});
