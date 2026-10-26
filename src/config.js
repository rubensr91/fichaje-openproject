export const CONFIG_KEY = "fichajeConfig";

export const DEFAULT_CONFIG = {
  gitlabBaseUrl: "",
  gitlabProject: "",
  gitlabAuthor: "",
  openprojectBaseUrl: "",
  openprojectProjectId: "",
  openprojectWorkPackageId: "",
  openprojectActivityId: "",
  openprojectActivityName: "Development",
  secretMode: "session",
  sendStartTime: true,
  startTimeMode: "browser",
  startTimeModeMigrated: false,
  llmBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  llmModel: "gemini-3.1-flash-lite",
  llmFilterMode: "redact",
  defaultStart: "08:00",
  defaultEnd: "15:15"
};

export async function getConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const config = { ...DEFAULT_CONFIG, ...(stored[CONFIG_KEY] || {}) };
  if (!config.llmBaseUrl) {
    config.llmBaseUrl = DEFAULT_CONFIG.llmBaseUrl;
  }
  if (!config.llmModel) {
    config.llmModel = DEFAULT_CONFIG.llmModel;
  }
  if (!config.startTimeModeMigrated) {
    config.startTimeMode = "browser";
    config.startTimeModeMigrated = true;
  }
  return config;
}

export async function saveConfig(patch) {
  const current = await getConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

export function isConfigured(config) {
  return Boolean(
    config.gitlabBaseUrl &&
      config.gitlabProject &&
      config.openprojectBaseUrl &&
      config.openprojectProjectId &&
      config.openprojectWorkPackageId
  );
}