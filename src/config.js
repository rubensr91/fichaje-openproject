const STORAGE_KEY = "fichajeConfig";

export const DEFAULT_CONFIG = {
  gitlabBaseUrl: "",
  gitlabProject: "",
  gitlabToken: "",
  gitlabAuthor: "",
  openprojectBaseUrl: "",
  openprojectProjectId: "",
  openprojectWorkPackageId: "",
  openprojectActivityId: "",
  openprojectActivityName: "Development",
  openprojectToken: "",
  sendStartTime: true,
  startTimeMode: "literal",
  llmBaseUrl: "",
  llmModel: "",
  llmApiKey: "",
  defaultStart: "08:00",
  defaultEnd: "15:15"
};

export async function getConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_CONFIG, ...(stored[STORAGE_KEY] || {}) };
}

export async function saveConfig(patch) {
  const current = await getConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function isConfigured(config) {
  return Boolean(
    config.gitlabBaseUrl &&
      config.gitlabProject &&
      config.gitlabToken &&
      config.openprojectBaseUrl &&
      config.openprojectProjectId &&
      config.openprojectWorkPackageId &&
      config.openprojectToken
  );
}