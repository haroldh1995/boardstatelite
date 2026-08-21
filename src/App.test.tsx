import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createGenericGroup } from "./domain/cards";
import {
  calculateTotals,
  createDefaultField,
  normalizeField,
} from "./domain/field";
import { MicrophoneStatusIndicator } from "./components/MicrophoneStatusIndicator";
import { AthenaDecisionSurface } from "./components/AthenaDecisionSurface";
import { Battlefield } from "./components/Battlefield";
import { useFieldStore } from "./state/useFieldStore";
import {
  animPakal,
  doublingSeason,
  fieldWith,
  testCard,
  tracked,
} from "./test/factories";
import { athenaDerivedStateEngine } from "./athena/derivedState";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./athena/eventForecast";
import { getZoneCompositionSnapshot } from "./domain/zoneComposition";
import {
  athenaDecisionStateFingerprint,
  buildAthenaDecisionCandidates,
  createAthenaDecisionRequest,
  enqueueAthenaDecision,
} from "./athena/decisionEngine";

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

  it("recalculates continuous values through canonical store commits", async () => {
    athenaDerivedStateEngine.discard();
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );

    useFieldStore.getState().addCard(
      testCard({
        name: "Glorious Anthem",
        typeLine: "Enchantment",
        oracleText: "Creatures you control get +1/+1.",
      }),
    );
    useFieldStore.getState().addGeneric({
      kind: "Creature",
      label: "Test creature",
      power: 2,
      toughness: 2,
    });

    const field = () => useFieldStore.getState().field;
    const anthem = () =>
      field().groups.find(
        (group) => group.identity?.name === "Glorious Anthem",
      )!;
    const recipient = () =>
      field().groups.find((group) => group.label === "Test creature")!;

    expect(recipient().pt.currentPower).toBe(3);
    expect(recipient().pt.currentToughness).toBe(3);

    useFieldStore.getState().setTrackingEnabled(anthem().id, false, "all", 1);
    expect(recipient().pt.currentPower).toBe(2);

    useFieldStore.getState().undo();
    expect(recipient().pt.currentPower).toBe(3);

    useFieldStore.getState().redo();
    expect(recipient().pt.currentPower).toBe(2);

    useFieldStore.getState().setTrackingEnabled(anthem().id, true, "all", 1);
    expect(recipient().pt.currentPower).toBe(3);
  }, 20_000);

  it("commits confirmed Athena events and automatic bookkeeping through one store boundary", () => {
    const field = fieldWith([
      tracked(
        testCard({
          name: "Soul Warden",
          typeLine: "Creature - Human Cleric",
          oracleText: "Whenever another creature enters, you gain 1 life.",
          power: "1",
          toughness: "1",
        }),
      ),
      tracked(doublingSeason()),
    ]);
    useFieldStore.setState({ field });
    const environment = createForecastEnvironment(field);
    const event = createAthenaForecastInput(
      {
        eventId: "store-confirmed-token-event",
        eventCategory: "token-created",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp: "2026-08-14T12:00:00.000Z",
        quantity: 2,
        knownCharacteristics: {
          cardTypes: ["Creature"],
          subtypes: ["Gnome"],
          isToken: true,
          isCreature: true,
        },
        tokenDefinition: {
          id: "token:gnome:1/1",
          name: "Gnome",
          power: 1,
          toughness: 1,
          characteristics: {
            cardTypes: ["Creature"],
            supertypes: [],
            subtypes: ["Gnome"],
            colors: [],
            manaValue: 0,
            isToken: true,
            isCreature: true,
            isLegendary: false,
            knownFields: [
              "cardTypes",
              "supertypes",
              "subtypes",
              "colors",
              "manaValue",
              "isToken",
              "isCreature",
              "isLegendary",
            ],
          },
        },
        metadata: { confirmed: true },
      },
      environment,
    );

    const result = useFieldStore.getState().processConfirmedAthenaEvent(event);

    expect(result.validity).toBe("committed");
    expect(useFieldStore.getState().field.player.life).toBe(44);
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Gnome")?.quantity,
    ).toBe(4);

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
    expect(
      useFieldStore
        .getState()
        .field.groups.some((group) => group.label === "Gnome"),
    ).toBe(false);
  });

  it("pauses only for an optional trigger decision and resumes bookkeeping immediately", () => {
    const field = fieldWith([
      tracked(
        testCard({
          name: "Soul's Attendant",
          typeLine: "Creature - Human Cleric",
          oracleText: "Whenever another creature enters, you may gain 1 life.",
          power: "1",
          toughness: "1",
        }),
      ),
    ]);
    useFieldStore.setState({ field, undoStack: [], redoStack: [] });
    const environment = createForecastEnvironment(field);
    const event = createAthenaForecastInput(
      {
        eventId: "optional-trigger-entry",
        eventCategory: "creature-entered",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp: "2026-08-20T12:00:00.000Z",
        quantity: 1,
        knownCharacteristics: {
          cardTypes: ["Creature"],
          isCreature: true,
          isToken: true,
        },
        metadata: { confirmed: true },
      },
      environment,
    );

    expect(
      useFieldStore.getState().processConfirmedAthenaEvent(event).validity,
    ).toBe("committed");
    const decision = useFieldStore
      .getState()
      .field.athena.decisions.requests.find(
        (entry) => entry.type === "optional-effect",
      );
    expect(decision?.status).toBe("active");
    expect(useFieldStore.getState().field.player.life).toBe(40);

    useFieldStore.getState().answerAthenaDecision(decision!.id, {
      accepted: true,
      responseId: "optional-yes",
    });
    expect(useFieldStore.getState().field.player.life).toBe(41);
    expect(
      useFieldStore
        .getState()
        .field.athena.decisions.requests.find(
          (entry) => entry.id === decision!.id,
        )?.status,
    ).toBe("answered");

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
    useFieldStore.getState().redo();
    expect(useFieldStore.getState().field.player.life).toBe(41);
  });

  it("lets an eligible battlefield card answer a contextual target directly", async () => {
    const user = userEvent.setup();
    let field = fieldWith([
      tracked(animPakal()),
      tracked(
        testCard({
          name: "Target Creature",
          typeLine: "Creature - Human",
          oracleText: "",
          power: "2",
          toughness: "2",
        }),
      ),
    ]);
    const candidates = buildAthenaDecisionCandidates(field, {
      controller: "you",
      zones: ["battlefield"],
      cardTypes: ["Creature"],
    });
    const decision = createAthenaDecisionRequest({
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      type: "target-selection",
      prompt: "Choose one target creature you control.",
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["battlefield"],
        cardTypes: ["Creature"],
      },
      stateFingerprint: athenaDecisionStateFingerprint(field),
      timestamp: field.updatedAt,
    });
    field = {
      ...field,
      athena: {
        ...field.athena,
        decisions: enqueueAthenaDecision(
          field.athena.decisions,
          decision,
          field.updatedAt,
        ),
      },
    };
    useFieldStore.setState({
      field,
      hydrated: true,
      startupVisible: false,
      modal: null,
      undoStack: [],
      redoStack: [],
    });
    render(
      <>
        <AthenaDecisionSurface />
        <Battlefield />
      </>,
    );

    expect(
      await screen.findByText("Choose one target creature you control."),
    ).toBeInTheDocument();
    const target = screen.getByRole("listitem", {
      name: /Anim Pakal.*Eligible target/i,
    });
    await user.click(target);

    expect(
      useFieldStore
        .getState()
        .field.athena.decisions.requests.find(
          (entry) => entry.id === decision.id,
        )?.answer?.targetGroupIds,
    ).toEqual([field.groups[0].id]);
  });

  it("identifies an untracked zone candidate without fabricating another zone entry", () => {
    const unknown = {
      ...createGenericGroup({
        kind: "Custom",
        label: "Unknown card",
        cardTypes: [],
      }),
      zone: "graveyard" as const,
    };
    let field = fieldWith([unknown]);
    const candidates = buildAthenaDecisionCandidates(
      field,
      {
        controller: "you",
        zones: ["graveyard"],
        cardTypes: ["Creature"],
        allowUntrackedZoneCard: true,
      },
      { zones: ["graveyard"] },
    );
    const decision = createAthenaDecisionRequest({
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      type: "zone-card-selection",
      prompt: "Choose a creature card from your graveyard.",
      candidates,
      targetConstraints: {
        controller: "you",
        zones: ["graveyard"],
        cardTypes: ["Creature"],
        allowUntrackedZoneCard: true,
      },
      stateFingerprint: athenaDecisionStateFingerprint(field),
      timestamp: field.updatedAt,
    });
    field = {
      ...field,
      athena: {
        ...field.athena,
        decisions: enqueueAthenaDecision(
          field.athena.decisions,
          decision,
          field.updatedAt,
        ),
      },
    };
    useFieldStore.setState({
      field,
      undoStack: [],
      redoStack: [],
    });
    const untracked = candidates.find(
      (candidate) => candidate.kind === "untracked-card",
    );

    expect(untracked).toBeDefined();
    useFieldStore
      .getState()
      .identifyAthenaDecisionZoneCard(decision.id, untracked!.id, animPakal());

    const current = useFieldStore.getState().field;
    expect(
      current.groups.filter((group) => group.zone === "graveyard"),
    ).toHaveLength(1);
    expect(current.groups[0].identity?.name).toBe(
      "Anim Pakal, Thousandth Moon",
    );
    expect(
      current.athena.decisions.requests.find(
        (entry) => entry.id === decision.id,
      )?.status,
    ).toBe("answered");

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.groups[0].identity).toBeNull();
  });

  it("corrects exile composition quickly and keeps outside dismissal non-mutating", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );

    await user.click(screen.getByRole("button", { name: "Exile: 0" }));
    expect(screen.getByRole("heading", { name: "Exile" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Total cards"));
    await user.type(screen.getByLabelText("Total cards"), "5");
    await user.click(screen.getByText("More categories"));
    await user.clear(screen.getByLabelText("Creature cards"));
    await user.type(screen.getByLabelText("Creature cards"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      getZoneCompositionSnapshot(useFieldStore.getState().field, "exile"),
    ).toMatchObject({
      physicalTotal: 5,
      unaccountedPhysicalCards: 5,
      categoryTotals: { creature: 2 },
    });

    await user.click(screen.getByRole("button", { name: "Exile: 5" }));
    await user.clear(screen.getByLabelText("Total cards"));
    await user.type(screen.getByLabelText("Total cards"), "8");
    fireEvent.pointerDown(container.querySelector(".modal-overlay")!);
    expect(screen.queryByRole("heading", { name: "Exile" })).toBeNull();
    expect(
      getZoneCompositionSnapshot(useFieldStore.getState().field, "exile")
        .physicalTotal,
    ).toBe(5);

    useFieldStore.getState().undo();
    expect(
      getZoneCompositionSnapshot(useFieldStore.getState().field, "exile")
        .physicalTotal,
    ).toBe(0);
    useFieldStore.getState().redo();
    expect(
      getZoneCompositionSnapshot(useFieldStore.getState().field, "exile")
        .categoryTotals.creature,
    ).toBe(2);
  }, 20_000);

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

  it("repairs multiple current values through Catch Me Up without gameplay events", async () => {
    const user = userEvent.setup();
    const lands = createGenericGroup({ kind: "Land", quantity: 8 });
    const treasure = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 4,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const base = createDefaultField();
    useFieldStore.setState({
      field: normalizeField({
        ...base,
        player: { ...base.player, life: 31 },
        groups: [lands, treasure],
      }),
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    await user.click(screen.getByRole("button", { name: /catch me up/i }));

    expect(
      screen.getByText(
        /correct current battlefield state without generating gameplay triggers/i,
      ),
    ).toBeInTheDocument();
    const lifeInput = screen.getByLabelText("Life current value");
    await user.clear(lifeInput);
    await user.type(lifeInput, "28");
    const landInput = screen.getByLabelText("Lands current value");
    await user.clear(landInput);
    await user.type(landInput, "9");
    const treasureInput = screen.getByLabelText("Treasure current value");
    await user.clear(treasureInput);
    await user.type(treasureInput, "6");
    await user.click(
      screen.getByRole("button", { name: /save current state/i }),
    );

    const current = useFieldStore.getState();
    expect(current.field.player.life).toBe(28);
    expect(calculateTotals(current.field.groups)).toMatchObject({
      lands: 9,
      treasureTokens: 6,
    });
    expect(current.lastResult).toBeNull();
    expect(current.undoStack.at(-1)).toMatchObject({
      label: "Reconciliation: Catch Me Up",
    });
    expect(current.field.athena.reconciliation.recent.at(-1)).toMatchObject({
      gameplayEventsGenerated: 0,
      triggersGenerated: 0,
      replacementEffectsApplied: false,
    });
  }, 20_000);

  it("opens the player counter editor from every top counter and applies manual corrections", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );

    for (const counterName of [
      "Poison",
      "Energy",
      "CMD Damage",
      "Experience",
    ]) {
      await user.click(
        screen.getByRole("button", {
          name: new RegExp(`${counterName}: 0\\. Tap to edit`, "i"),
        }),
      );
      expect(
        screen.getByRole("heading", { name: /player counters/i }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /close/i }));
    }

    await user.click(
      screen.getByRole("button", { name: /poison: 0\. tap to edit/i }),
    );
    const poisonInput = screen.getByLabelText(/^poison$/i);
    await user.clear(poisonInput);
    await user.type(poisonInput, "7");
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(
      screen.getByRole("button", { name: /poison: 7\. tap to edit/i }),
    ).toBeInTheDocument();
    expect(useFieldStore.getState().field.player.counters.poison).toBe(7);

    await user.click(
      screen.getByRole("button", { name: /expand life controls/i }),
    );
    await user.click(screen.getByRole("button", { name: /^undo$/i }));
    expect(useFieldStore.getState().field.player.counters.poison).toBe(0);
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
    expect(screen.getByText(/adaptive listening tail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/listening tail duration/i)).toHaveValue(
      "3000",
    );
    expect(screen.getByLabelText(/listening sensitivity/i)).toHaveValue(
      "balanced",
    );

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
    expect(screen.queryByText(/grammar diagnostics/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/grammar testing/i)).not.toBeInTheDocument();
    expect(
      useFieldStore.getState().field.settings.voice.verification.privacy
        .rawAudioRetained,
    ).toBe(false);
  }, 20_000);

  it("shows an accessible quick mute toggle beside the microphone badge", async () => {
    const user = userEvent.setup();
    const originalToggle = useFieldStore.getState().toggleListeningMute;
    const toggleListeningMute = vi.fn(async () => undefined);
    const field = createDefaultField();
    useFieldStore.setState({
      field: {
        ...field,
        settings: {
          ...field.settings,
          voice: {
            ...field.settings.voice,
            voiceFeaturesEnabled: true,
            ambientListeningEnabled: true,
          },
        },
        listening: {
          ...field.listening,
          status: "stopped",
          permission: "granted",
          availability: "available",
          indicator: "ready",
        },
      },
      toggleListeningMute,
    });

    try {
      render(<MicrophoneStatusIndicator />);

      const button = screen.getByRole("button", {
        name: /unmute microphone listening/i,
      });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-pressed", "false");

      await user.click(button);

      expect(toggleListeningMute).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/listening muted/i)).toBeInTheDocument();
    } finally {
      useFieldStore.setState({ toggleListeningMute: originalToggle });
    }
  }, 20_000);

  it("exposes local-only personalization controls without gameplay automation", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /continue to field/i }),
    );
    await user.click(screen.getByRole("button", { name: /^tools$/i }));

    expect(
      screen.getByRole("heading", { name: /personalization/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /personal gameplay model/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /^smart suggestions$/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /predictive intent assistance/i,
      }),
    ).toBeChecked();
    expect(screen.getAllByText(/scope: local only/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /does not choose plays, optimize decks, or automate gameplay/i,
      ),
    ).toBeInTheDocument();
    expect(
      useFieldStore.getState().field.settings.personalGameplay
        .gameplayAutomationEnabled,
    ).toBe(false);
    expect(
      useFieldStore.getState().field.settings.personalGameplay
        .deckOptimizationEnabled,
    ).toBe(false);
    expect(screen.queryByText(/athena/i)).not.toBeInTheDocument();
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
    await user.type(screen.getByLabelText(/plan title/i), "Forest");
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
      screen.getAllByRole("button", { name: /^Play Forest/i })[0],
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
