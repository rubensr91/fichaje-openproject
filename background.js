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

function groupEntriesByDate(entries) {
  const byDate = new Map();
  for (const entry of entries) {
    const date = String(entry.spentOn || "").slice(0, 10);
    if (!date) {
      continue;
    }
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date).push(entry);
  }
  return byDate;
}

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
      const entries = await getExistingEntries(config, message.date, user);
      return {
        user: { id: user.id, name: user.name || user.login },
        entries
      };
    }

    case "CHECK_EXISTING_RANGE": {
      const user = await getCurrentUser(config);
      const entries = await getExistingEntriesForDates(config, message.dates, user);
      return {
        user: { id: user.id, name: user.name || user.login },
        byDate: Object.fromEntries(groupEntriesByDate(entries))
      };
    }

    case "CREATE_ENTRIES": {
      const dates = message.entries.map((item) => item.date);
      const user = await getCurrentUser(config);
      const existing = await getExistingEntriesForDates(config, dates, user);
      const byDate = groupEntriesByDate(existing);

      const activity = await detectActivity(
        config,
        config.openprojectActivityName || "Development"
      );

      const results = { created: [], skipped: [], failed: [] };
      for (const item of message.entries) {
        const already = byDate.get(item.date) || [];
        if (already.length) {
          results.skipped.push({
            date: item.date,
            reason: `Ya existía un fichaje (ID ${already.map((entry) => entry.id).join(", ")})`
          });
          continue;
        }
        try {
          const entry = await createTimeEntry(config, {
            date: item.date,
            start: item.start,
            end: item.end,
            comment: item.comment,
            activity
          });
          results.created.push({
            date: item.date,
            id: entry.id,
            hours: entry.hours || null
          });
          byDate.set(item.date, [entry]);
        } catch (error) {
          results.failed.push({ date: item.date, error: error.message });
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