import { getRuntimeConfig } from "./src/secrets.js";
import { fetchDay, testGitLab } from "./src/gitlab.js";
import {
  createTimeEntry,
  detectActivity,
  getAvailableProjects,
  getCurrentUser,
  getExistingEntries,
  getProjectWorkPackages,
  testOpenProject
} from "./src/openproject.js";
import { summarize } from "./src/llm.js";

function configureSidePanel() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }
}

configureSidePanel();
chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    } catch {
      // Brave/Chromium sin side panel: se abre como pestaña.
    }
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
});

async function handle(message) {
  const config = await getRuntimeConfig();

  switch (message.type) {
    case "TEST_CONNECTIONS": {
      const [gitlab, openproject] = await Promise.allSettled([
        testGitLab(config),
        testOpenProject(config)
      ]);
      return {
        gitlab:
          gitlab.status === "fulfilled"
            ? { ok: true, ...gitlab.value }
            : { ok: false, error: gitlab.reason?.message || String(gitlab.reason) },
        openproject:
          openproject.status === "fulfilled"
            ? { ok: true, ...openproject.value }
            : { ok: false, error: openproject.reason?.message || String(openproject.reason) },
        llm: {
          configured: Boolean(
            config.llmApiKey && config.llmBaseUrl && config.llmModel
          )
        }
      };
    }

    case "LIST_PROJECTS": {
      return getAvailableProjects(config);
    }

    case "LIST_WORK_PACKAGES": {
      return getProjectWorkPackages(config, message.projectId);
    }

    case "FETCH_DAY": {
      const data = await fetchDay(config, message.date);
      return data;
    }

    case "GENERATE_SUMMARY": {
      if (!message.evidence) {
        throw new Error("Faltan los datos de GitLab");
      }
      return summarize(config, {
        date: message.date,
        projectName: message.projectName || "",
        evidence: message.evidence
      });
    }

    case "CHECK_EXISTING": {
      const user = await getCurrentUser(config);
      const entries = await getExistingEntries(config, message.date, user);
      return {
        user: { id: user.id, name: user.name || user.login },
        entries
      };
    }

    case "DETECT_ACTIVITY": {
      const activity = await detectActivity(
        config,
        message.name || config.openprojectActivityName || "Development",
        { force: true }
      );
      return activity;
    }

    case "CREATE_ENTRY": {
      const user = await getCurrentUser(config);
      const existing = await getExistingEntries(config, message.date, user);
      if (existing.length > 0) {
        throw new Error(
          `Ya existe un fichaje para el ${message.date} en este proyecto (ID ${existing
            .map((entry) => entry.id)
            .join(", ")}). No se ha creado otro.`
        );
      }

      const activity = await detectActivity(
        config,
        config.openprojectActivityName || "Development"
      );
      return createTimeEntry(config, {
        date: message.date,
        start: message.start,
        end: message.end,
        comment: message.comment,
        activity
      });
    }

    default:
      throw new Error(`Mensaje no soportado: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});