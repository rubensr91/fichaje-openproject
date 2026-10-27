import { requestJson, trimBase, withQuery } from "./http.js";
import { assertDateISO, localDateRangeToUTC } from "./time.js";

function apiUrl(config, path) {
  return `${trimBase(config.gitlabBaseUrl)}/api/v4${path}`;
}

function headers(config) {
  return {
    "PRIVATE-TOKEN": config.gitlabToken,
    Accept: "application/json"
  };
}

async function gitlabGet(config, path, params = {}) {
  if (!config.gitlabToken) {
    throw new Error("Falta el token de GitLab");
  }
  const url = withQuery(apiUrl(config, path), params);
  try {
    return await requestJson(url, { headers: headers(config) });
  } catch (error) {
    throw new Error(`GitLab ${path}: ${error.message}`);
  }
}

async function getAll(config, path, params = {}, maxPages = 10) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await gitlabGet(config, path, { ...params, page, per_page: 100 });
    if (!Array.isArray(batch)) {
      throw new Error(`Respuesta inesperada de GitLab en ${path}`);
    }
    items.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return items;
}

export async function getCurrentUser(config) {
  return gitlabGet(config, "/user");
}

export async function getProject(config) {
  if (!config.gitlabProject) {
    throw new Error("Falta el proyecto de GitLab");
  }
  return gitlabGet(config, `/projects/${encodeURIComponent(config.gitlabProject)}`);
}

function authorNeedles(config, user) {
  const configured = String(config.gitlabAuthor || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length) {
    return configured;
  }

  return [user?.email, user?.name, user?.username]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
}

function filterCommits(commits, config, user) {
  const needles = authorNeedles(config, user);
  if (!needles.length) {
    return { commits, warning: null };
  }

  const matched = commits.filter((commit) => {
    const haystack = `${commit.author_name || ""} ${commit.author_email || ""}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });

  if (matched.length === 0 && commits.length > 0) {
    return {
      commits,
      warning:
        "No se pudo identificar tu autoría en los commits. Se incluyen todos los commits del proyecto para ese día. " +
        "Configura «Autor GitLab» con tu nombre o email de commit."
    };
  }

  return { commits: matched, warning: null };
}

async function fetchDayActivity(config, date, user, project) {
  const { after, before } = localDateRangeToUTC(date);
  const projectPath = `/projects/${encodeURIComponent(config.gitlabProject)}`;

  const [rawCommits, mergeRequests, issues] = await Promise.all([
    getAll(config, `${projectPath}/repository/commits`, {
      since: after,
      until: before,
      with_stats: true
    }),
    getAll(config, `${projectPath}/merge_requests`, {
      author_id: user.id,
      state: "all",
      updated_after: after,
      updated_before: before,
      order_by: "updated_at",
      sort: "desc"
    }),
    getAll(config, `${projectPath}/issues`, {
      author_id: user.id,
      state: "all",
      updated_after: after,
      updated_before: before,
      order_by: "updated_at",
      sort: "desc"
    })
  ]);

  const filtered = filterCommits(rawCommits, config, user);

  return {
    date,
    gitlabUser: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email || ""
    },
    project: {
      id: project.id,
      name: project.name,
      path: project.path_with_namespace || config.gitlabProject,
      webUrl: project.web_url || ""
    },
    commits: filtered.commits.map((commit) => ({
      id: commit.id,
      shortId: commit.short_id,
      title: commit.title,
      message: commit.message,
      author_name: commit.author_name,
      author_email: commit.author_email,
      created_at: commit.created_at,
      web_url: commit.web_url,
      stats: commit.stats || null
    })),
    mergeRequests: mergeRequests.map((mr) => ({
      iid: mr.iid,
      title: mr.title,
      description: mr.description,
      state: mr.state,
      created_at: mr.created_at,
      updated_at: mr.updated_at,
      web_url: mr.web_url
    })),
    issues: issues.map((issue) => ({
      iid: issue.iid,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      web_url: issue.web_url
    })),
    warning: filtered.warning,
    counts: {
      commits: filtered.commits.length,
      mergeRequests: mergeRequests.length,
      issues: issues.length
    }
  };
}

export async function fetchDay(config, date) {
  const [user, project] = await Promise.all([getCurrentUser(config), getProject(config)]);
  return fetchDayActivity(config, date, user, project);
}

export async function fetchRange(config, dates) {
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new Error("El rango de fechas está vacío");
  }
  const [user, project] = await Promise.all([getCurrentUser(config), getProject(config)]);
  const days = [];
  for (const date of dates) {
    days.push(await fetchDayActivity(config, date, user, project));
  }
  return days;
}

function isoDayOffset(dateISO, delta) {
  const date = new Date(`${assertDateISO(dateISO)}T00:00:00`);
  date.setDate(date.getDate() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchEventsForDay(config, date) {
  const { after, before } = localDateRangeToUTC(date);
  const startMs = new Date(after).getTime();
  const endMs = new Date(before).getTime();
  // Ventana amplia por si la API trata after/before como exclusivos; se filtra aquí.
  const events = await getAll(config, "/events", {
    after: isoDayOffset(date, -1),
    before: isoDayOffset(date, 2)
  });
  return events.filter((event) => {
    const created = new Date(event.created_at).getTime();
    return created >= startMs && created < endMs;
  });
}

function mapEventState(action) {
  const value = String(action || "").toLowerCase();
  if (value === "merged") {
    return "merged";
  }
  if (value === "closed") {
    return "closed";
  }
  if (value === "created" || value === "reopened") {
    return "opened";
  }
  return "updated";
}

const TRACKED_ACTIONS = new Set([
  "pushed to",
  "pushed new",
  "created",
  "merged",
  "closed",
  "reopened",
  "commented"
]);

export async function fetchRangeAll(config, dates) {
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new Error("El rango de fechas está vacío");
  }
  const user = await getCurrentUser(config);

  const eventsByDay = new Map();
  const projectIds = new Set();
  for (const date of dates) {
    const events = (await fetchEventsForDay(config, date)).filter((event) =>
      TRACKED_ACTIONS.has(String(event.action_name || "").toLowerCase())
    );
    eventsByDay.set(date, events);
    for (const event of events) {
      if (event.project_id) {
        projectIds.add(event.project_id);
      }
    }
  }

  const projectNames = new Map();
  for (const projectId of projectIds) {
    try {
      const project = await gitlabGet(config, `/projects/${encodeURIComponent(String(projectId))}`, {
        simple: true
      });
      projectNames.set(projectId, project.path_with_namespace || project.name);
    } catch {
      projectNames.set(projectId, `proyecto ${projectId}`);
    }
  }

  const warning =
    "Extraído de eventos de GitLab: en los pushes solo se ve el último commit. " +
    "Para el detalle completo, configura un proyecto concreto.";

  return dates.map((date) => {
    const commits = [];
    const mergeRequests = new Map();
    const issues = new Map();

    for (const event of eventsByDay.get(date) || []) {
      const projectLabel = `[${projectNames.get(event.project_id) || "proyecto"}]`;
      const action = String(event.action_name || "").toLowerCase();

      if (action === "pushed to" || action === "pushed new") {
        const pushData = event.push_data || {};
        const title = pushData.commit_title || event.target_title || "push";
        const detail = `push de ${pushData.commit_count || 1} commit(s) a ${
          pushData.ref || "?"
        }`;
        commits.push({
          title: `${projectLabel} ${title}`,
          message: `${title} | ${detail}`,
          author_name: user.name,
          author_email: user.email || "",
          created_at: event.created_at,
          web_url: "",
          stats: null
        });
        continue;
      }

      if (event.target_type === "MergeRequest") {
        const existing = mergeRequests.get(event.target_iid);
        const state = mapEventState(action);
        if (!existing || state !== "updated") {
          mergeRequests.set(event.target_iid, {
            iid: event.target_iid,
            title: `${projectLabel} ${event.target_title || "MR"}`,
            description: "",
            state: state === "updated" ? existing?.state || state : state,
            created_at: event.created_at,
            updated_at: event.created_at,
            web_url: ""
          });
        }
        continue;
      }

      if (event.target_type === "Issue") {
        const existing = issues.get(event.target_iid);
        const state = mapEventState(action);
        if (!existing || state !== "updated") {
          issues.set(event.target_iid, {
            iid: event.target_iid,
            title: `${projectLabel} ${event.target_title || "Issue"}`,
            description: "",
            state: state === "updated" ? existing?.state || state : state,
            created_at: event.created_at,
            updated_at: event.created_at,
            web_url: ""
          });
        }
        continue;
      }

      if (action === "commented") {
        commits.push({
          title: `${projectLabel} comentario: ${event.target_title || ""}`.trim(),
          message: "",
          author_name: user.name,
          author_email: user.email || "",
          created_at: event.created_at,
          web_url: "",
          stats: null
        });
      }
    }

    const mergeRequestsList = [...mergeRequests.values()];
    const issuesList = [...issues.values()];

    return {
      date,
      gitlabUser: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email || ""
      },
      project: {
        id: null,
        name: "Todas las contribuciones",
        path: "Todas las contribuciones",
        webUrl: ""
      },
      commits,
      mergeRequests: mergeRequestsList,
      issues: issuesList,
      warning,
      counts: {
        commits: commits.length,
        mergeRequests: mergeRequestsList.length,
        issues: issuesList.length
      }
    };
  });
}

export async function fetchDayAll(config, date) {
  return (await fetchRangeAll(config, [date]))[0];
}

export async function testGitLab(config) {
  const user = await getCurrentUser(config);
  if ((config.gitlabMode || "project") === "all") {
    return {
      user: user.username || user.name,
      project: "Todas las contribuciones (eventos)",
      projectId: null
    };
  }
  const project = await getProject(config);
  return {
    user: user.username || user.name,
    project: project.path_with_namespace || project.name,
    projectId: project.id
  };
}