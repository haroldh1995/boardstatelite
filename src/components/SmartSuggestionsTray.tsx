import { useMemo } from "react";
import { Lightbulb, X } from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";

export function SmartSuggestionsTray() {
  const enabled = useFieldStore(
    (state) => state.field.settings.personalGameplay.smartSuggestionsEnabled,
  );
  const suggestions = useFieldStore(
    (state) => state.field.personalGameplay.suggestions,
  );
  const accept = useFieldStore((state) => state.acceptSmartSuggestion);
  const dismiss = useFieldStore((state) => state.dismissSmartSuggestion);

  const activeSuggestions = useMemo(
    () =>
      enabled
        ? suggestions
            .filter((suggestion) => suggestion.status === "available")
            .slice(0, 1)
        : [],
    [enabled, suggestions],
  );

  const suggestion = activeSuggestions[0];
  if (!suggestion) return null;

  return (
    <aside
      className="smart-suggestion-tray"
      role="status"
      aria-live="polite"
      aria-label="Smart suggestion"
    >
      <Lightbulb aria-hidden="true" />
      <span>
        <strong>{suggestion.message}</strong>
        <small>{suggestion.detail}</small>
      </span>
      <button
        type="button"
        className="quiet-action"
        onClick={() => accept(suggestion.id)}
      >
        Use
      </button>
      <button
        type="button"
        aria-label="Dismiss smart suggestion"
        onClick={() => dismiss(suggestion.id)}
      >
        <X />
      </button>
    </aside>
  );
}
