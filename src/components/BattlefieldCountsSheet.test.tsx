import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BattlefieldCountsSheet } from "./BattlefieldCountsSheet";
import { createDefaultField } from "../domain/field";
import { createCardGroup } from "../domain/cards";
import { testCard } from "../test/factories";
import { useFieldStore } from "../state/useFieldStore";

afterEach(cleanup);
it("rederives on every opening, stays live, and drills down to canonical contributors", () => {
  const field = createDefaultField();
  const forest = createCardGroup(
    testCard({
      name: "Forest",
      typeLine: "Basic Land - Forest",
      oracleText: "{T}: Add {G}.",
    }),
    2,
  );
  field.groups = [forest];
  useFieldStore.setState({ field });
  const view = render(<BattlefieldCountsSheet />);
  expect(screen.getByRole("button", { name: "Land 2" })).toBeInTheDocument();
  act(() =>
    useFieldStore.setState({
      field: { ...field, groups: [{ ...forest, quantity: 3 }] },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Land 3" }));
  expect(screen.getByRole("button", { name: "Forest 3" })).toBeInTheDocument();
  view.unmount();
  useFieldStore.setState({ field: { ...field, groups: [] } });
  render(<BattlefieldCountsSheet />);
  expect(screen.getByRole("button", { name: "Land 0" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Forest 3" })).toBeNull();
});
