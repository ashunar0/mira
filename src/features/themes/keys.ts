export const themeKeys = {
  all: ["themes"] as const,
  list: ["themes", "list"] as const,
  theme: (settingsId: string) => ["themes", "theme", settingsId] as const,
};
