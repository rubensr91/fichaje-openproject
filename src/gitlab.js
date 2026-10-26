import { requestJson, trimBase, withQuery } from "./http.js";
import { localDateRangeToUTC } from "./time.js";

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

export async function fetchDay(config, date) {
  const { after, before } = localDateRangeToUTC(date);
  const [user, project] = await Promise.all([getCurrentUser(config), getProject(config)]);
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

export async function testGitLab(config) {
  const [user, project] = await Promise.all([getCurrentUser(config), getProject(config)]);
  return {
    user: user.username || user.name,
    project: project.path_with_namespace || project.name,
    projectId: project.id
  };
}