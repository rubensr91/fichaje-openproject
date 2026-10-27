import { getRuntimeConfig } from "./src/secrets.js";
import {
  fetchDay,
  fetchDayAll,
  fetchRange,
  fetchRangeAll,
  testGitLab
} from "./src/gitlab.js";
import {
  createTimeEntry,
  detectActivity,
  getAvailableProjects,
  getCurrentUser,
  getExistingEntries,
  getExistingEntriesForDates,
  getProjectWorkPackages,
  testOpenProject
} from "./src/openproject.js";
import { summarize } from "./src/llm.js";
import { pairKey, planEntryActions, splitExisting } from "./src/weekly.js";

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
      if ((config.gitlabMode || "all") === "all") {
        return fetchDayAll(config, message.date);
      }
      return fetchDay(config, message.date);
    }

    case "FETCH_RANGE": {
      if ((config.gitlabMode || "all") === "all") {
        return fetchRangeAll(config, message.dates);
      }
      return fetchRange(config, message.dates);
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
      const target = String(message.projectId || config.openprojectProjectId || "");
      const all = await getExistingEntriesForDates(config, [message.date], user, "*");
      const split = splitExisting(all, target);
      return {
        user: { id: user.id, name: user.name || user.login },
        entries: split.byDate[message.date] || [],
        allEntries: split.allByDate[message.date] || []
      };
    }

    case "CHECK_EXISTING_RANGE": {
      const user = await getCurrentUser(config);
      const target = String(message.projectId || config.openprojectProjectId || "");
      const all = await getExistingEntriesForDates(config, message.dates, user, "*");
      const split = splitExisting(all, target);
      return {
        user: { id: user.id, name: user.name || user.login },
        byDate: split.byDate,
        allByDate: split.allByDate
      };
    }

    case "CREATE_ENTRIES": {
      const user = await getCurrentUser(config);
      const defaultProject = String(config.openprojectProjectId || "");
      const items = message.entries.map((item) => ({
        ...item,
        projectId: String(item.projectId || defaultProject)
      }));

      // Duplicados: por par (día, proyecto), con política consumir-una.
      const projectIds = [...new Set(items.map((item) => item.projectId))];
      const existingIdsByPair = new Map();
      for (const projectId of projectIds) {
        const dates = [
          ...new Set(
            items.filter((item) => item.projectId === projectId).map((item) => item.date)
          )
        ];
        const existing = await getExistingEntriesForDates(config, dates, user, projectId);
        for (const entry of existing) {
          const key = pairKey(String(entry.spentOn || "").slice(0, 10), projectId);
          if (!existingIdsByPair.has(key)) {
            existingIdsByPair.set(key, []);
          }
          existingIdsByPair.get(key).push(entry.id);
        }
      }

      const activity = await detectActivity(
        config,
        config.openprojectActivityName || "Development"
      );

      const plan = planEntryActions(items, existingIdsByPair);
      const results = { created: [], skipped: [...plan.skipped], failed: [] };

      for (const item of plan.toCreate) {
        try {
          const entry = await createTimeEntry(config, {
            date: item.date,
            start: item.start,
            end: item.end,
            comment: item.comment,
            workPackageId: item.workPackageId,
            projectId: item.projectId,
            activity
          });
          results.created.push({
            lineId: item.lineId,
            date: item.date,
            id: entry.id,
            hours: entry.hours || null
          });
        } catch (error) {
          results.failed.push({ lineId: item.lineId, date: item.date, error: error.message });
        }
      }
      return results;
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