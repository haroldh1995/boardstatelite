import type { SettingsState } from "../domain/types";
import { createParticipantId } from "../sharedSession";
import {
  HUB_APPLICATION_ID,
  type EcosystemProfile,
  type EcosystemProfileStatus,
} from "./types";

export function createProfileId(): string {
  return createParticipantId().replace("BS-PARTICIPANT-", "BS-PROFILE-");
}

export function createLocalProfile(
  timestamp = new Date().toISOString(),
  settings?: Partial<SettingsState>,
): EcosystemProfile {
  return {
    id: createProfileId(),
    status: "local-anonymous",
    displayName: "Local Player",
    avatarUrl: null,
    source: "local",
    createdAt: timestamp,
    updatedAt: timestamp,
    themePreferences: {
      accent: settings?.themeAccent ?? "verdant",
    },
    accessibilityPreferences: {
      reducedMotion: Boolean(settings?.reducedMotion),
    },
    connectedApplications: [HUB_APPLICATION_ID],
    favoriteFormats: [],
    favoriteDecks: [],
    preferencesSyncEnabled: false,
  };
}

export function normalizeLocalProfile(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    settings?: Partial<SettingsState>;
  },
): EcosystemProfile {
  const defaults = createLocalProfile(
    options.fallbackTimestamp,
    options.settings,
  );
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EcosystemProfile>;
  return {
    ...defaults,
    ...candidate,
    id: typeof candidate.id === "string" ? candidate.id : defaults.id,
    status: normalizeProfileStatus(candidate.status),
    displayName: sanitizeLabel(candidate.displayName, "Local Player"),
    avatarUrl:
      typeof candidate.avatarUrl === "string" ? candidate.avatarUrl : null,
    source: "local",
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : defaults.createdAt,
    updatedAt: options.fallbackTimestamp,
    themePreferences: {
      accent:
        candidate.themePreferences?.accent === "sapphire" ||
        candidate.themePreferences?.accent === "violet"
          ? candidate.themePreferences.accent
          : (options.settings?.themeAccent ?? defaults.themePreferences.accent),
    },
    accessibilityPreferences: {
      reducedMotion: Boolean(
        options.settings?.reducedMotion ??
        candidate.accessibilityPreferences?.reducedMotion ??
        defaults.accessibilityPreferences.reducedMotion,
      ),
    },
    connectedApplications: [HUB_APPLICATION_ID],
    favoriteFormats: Array.isArray(candidate.favoriteFormats)
      ? candidate.favoriteFormats
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 20)
      : [],
    favoriteDecks: Array.isArray(candidate.favoriteDecks)
      ? candidate.favoriteDecks
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 50)
      : [],
    preferencesSyncEnabled: false,
  };
}

function normalizeProfileStatus(value: unknown): EcosystemProfileStatus {
  void value;
  return "local-anonymous";
}

function sanitizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return (
    value
      .replace(/[<>{}`]/g, "")
      .trim()
      .slice(0, 80) || fallback
  );
}
