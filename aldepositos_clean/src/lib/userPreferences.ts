export type PanelTheme = "light" | "dark";
export type StartView =
  | "dashboard"
  | "quick-entry"
  | "detailed-entry"
  | "reports"
  | "productivity"
  | "monitor";
export type TimeFormat = "24h" | "12h";

export type UserPreferences = {
  theme: PanelTheme;
  avatarDataUrl: string | null;
  startView: StartView;
  timeFormat: TimeFormat;
  showSeconds: boolean;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "light",
  avatarDataUrl: null,
  startView: "dashboard",
  timeFormat: "24h",
  showSeconds: false,
};

export function userPrefsStorageKey(userId: string): string {
  return `aldepositos_user_prefs_v1_${userId}`;
}

export function sanitizeUserPreferences(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== "object") return DEFAULT_USER_PREFERENCES;
  const value = raw as Partial<UserPreferences>;
  return {
    theme: value.theme === "dark" ? "dark" : "light",
    avatarDataUrl:
      typeof value.avatarDataUrl === "string" && value.avatarDataUrl.trim().length > 0
        ? value.avatarDataUrl
        : null,
    startView:
      value.startView === "quick-entry" ||
      value.startView === "detailed-entry" ||
      value.startView === "reports" ||
      value.startView === "productivity" ||
      value.startView === "monitor"
        ? value.startView
        : "dashboard",
    timeFormat: value.timeFormat === "12h" ? "12h" : "24h",
    showSeconds: value.showSeconds === true,
  };
}
