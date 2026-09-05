import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import { deriveGameplayReminders } from "../domain/gameplayReminders";
import { useFieldStore } from "../state/useFieldStore";

export function GameplayReminderBanner() {
  const field = useFieldStore((state) => state.field);
  const openModal = useFieldStore((state) => state.openModal);
  const reminder = deriveGameplayReminders(field)[0] ?? null;
  const reminderId = reminder?.id ?? null;
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    if (dismissedId && reminderId !== dismissedId) setDismissedId(null);
  }, [dismissedId, reminderId]);

  if (!reminder || reminder.id === dismissedId) return null;
  return (
    <aside
      className="gameplay-reminder"
      aria-label={reminder.message}
      data-testid="gameplay-reminder"
    >
      <BellRing aria-hidden="true" />
      <span>{reminder.message}</span>
      <button
        type="button"
        className="gameplay-reminder-action"
        onClick={() => openModal({ kind: "landPlay" })}
      >
        {reminder.actionLabel}
      </button>
      <button
        type="button"
        className="gameplay-reminder-dismiss"
        aria-label="Dismiss gameplay reminder"
        onClick={() => setDismissedId(reminder.id)}
      >
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
