import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { createDefaultField } from "./domain/field";
import { useFieldStore } from "./state/useFieldStore";
import { animPakal } from "./test/factories";

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
  }, 20_000);

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
  }, 20_000);

  it("loads Lite without original BoardState globals and shows primary controls", async () => {
    const globals = globalThis as typeof globalThis & {
      BoardState?: unknown;
      BoardStateHub?: unknown;
    };
    const previousBoardState = globals.BoardState;
    const previousBoardStateHub = globals.BoardStateHub;
    delete globals.BoardState;
    delete globals.BoardStateHub;

    try {
      const user = userEvent.setup();
      render(<App />);

      await user.click(
        await screen.findByRole("button", { name: /continue to field/i }),
      );

      expect(screen.getByLabelText("Baord State Lite")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /40 tap to set life total/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /activate field/i }),
      ).toBeInTheDocument();
    } finally {
      if (previousBoardState === undefined) delete globals.BoardState;
      else globals.BoardState = previousBoardState;
      if (previousBoardStateHub === undefined) delete globals.BoardStateHub;
      else globals.BoardStateHub = previousBoardStateHub;
    }
  }, 20_000);

  it("renders a mocked Scryfall-backed card through the current Lite store flow", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    act(() => useFieldStore.getState().addCard(animPakal()));

    expect(
      await screen.findByLabelText(
        /Anim Pakal, Thousandth Moon, stack size 1/i,
      ),
    ).toBeInTheDocument();
  }, 20_000);

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
  }, 20_000);

  it("opens the pre-turn planner and edits planned actions without changing battlefield state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    await user.click(
      screen.getByRole("button", { name: /open pre-turn planner/i }),
    );

    expect(
      screen.getByRole("heading", { name: /one-minute pre-turn planner/i }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/action type/i), [
      "spell-sequence",
    ]);
    await user.type(screen.getByLabelText(/plan title/i), "Cast Sol Ring");
    await user.type(screen.getByLabelText(/^Reminder$/i), "Cast before combat");
    await user.type(screen.getByLabelText(/^Notes$/i), "Use floating mana.");
    await user.click(
      screen.getByRole("button", { name: /add planned action/i }),
    );

    expect(screen.getAllByText("Cast Sol Ring").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/prepared for future action strip/i),
    ).toBeInTheDocument();
    expect(useFieldStore.getState().field.preTurnPlanner.actions).toHaveLength(
      1,
    );
    expect(useFieldStore.getState().field.groups).toHaveLength(1);
    expect(useFieldStore.getState().undoStack).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: /mark cast sol ring complete/i }),
    );
    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("completed");
  }, 20_000);

  it("exposes opt-in microphone settings without enabling unfinished voice features", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /^tools$/i }));

    expect(
      screen.getByRole("heading", { name: /voice & microphone/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/enable voice features/i)).not.toBeChecked();
    expect(screen.getByLabelText(/enable ambient listening/i)).toBeDisabled();
    expect(screen.getByLabelText(/push-to-talk \(future\)/i)).toBeDisabled();
    expect(
      screen.getByLabelText(/always listening \(future\)/i),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /microphone test/i }),
    ).toBeDisabled();

    await user.click(screen.getByLabelText(/enable voice features/i));
    await waitFor(() =>
      expect(
        useFieldStore.getState().field.settings.voice.voiceFeaturesEnabled,
      ).toBe(true),
    );
    expect(screen.getByLabelText(/enable ambient listening/i)).toBeEnabled();
    expect(
      useFieldStore.getState().field.listening.privacy.rawAudioRetention,
    ).toBe("none");

    await user.click(
      screen.getByRole("button", { name: /begin voice enrollment/i }),
    );
    expect(screen.getByText(/personal voice enrollment/i)).toBeInTheDocument();
    expect(screen.getByText(/play a forest/i)).toBeInTheDocument();
    expect(
      useFieldStore.getState().field.settings.voice.enrollment.profile.status,
    ).toBe("enrolling");
    expect(
      useFieldStore.getState().field.settings.voice.enrollment.profile.privacy
        .rawAudioRetained,
    ).toBe(false);
    expect(screen.getAllByText(/speaker verification/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByLabelText(/verification sensitivity/i)).toHaveValue(
      "commanderStrict",
    );
    expect(
      screen.getByRole("button", { name: /verification test/i }),
    ).toBeDisabled();
    expect(
      useFieldStore.getState().field.settings.voice.verification.privacy
        .rawAudioRetained,
    ).toBe(false);
  }, 20_000);

  it("shows the active turn action strip and routes planned actions through undoable Ambient events", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    await user.click(
      screen.getByRole("button", { name: /open pre-turn planner/i }),
    );
    await user.type(screen.getByLabelText(/plan title/i), "Command Tower");
    await user.click(
      screen.getByRole("button", { name: /add planned action/i }),
    );
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("region", { name: /active turn action strip/i }),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: /^Begin Turn/i })[0],
    );
    expect(useFieldStore.getState().field.ambient.currentMode).toBe(
      "activeTurn",
    );
    await user.click(
      screen.getAllByRole("button", { name: /^Play Command Tower/i })[0],
    );

    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("completed");
    expect(useFieldStore.getState().undoStack.length).toBeGreaterThanOrEqual(2);
    useFieldStore.getState().undo();
    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("planned");
  }, 20_000);
});
