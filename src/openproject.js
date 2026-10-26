import { requestJson, trimBase, withQuery } from "./http.js";
import {
  browserTimeZone,
  hoursToDuration,
  localDateTimeToUTC,
  rangeHours,
  zonedTimeToUTC
} from "./time.js";

function apiUrl(config, path) {
  return `${trimBase(config.openprojectBaseUrl)}/api/v3${path}`;
}

function headers(config) {
  return {
    Authorization: `Bearer ${config.openprojectToken}`,
    Accept: "application/hal+json, application/json",
    "Content-Type": "application/json"
  };
}

async function opGet(config, path, params = {}) {
  if (!config.openprojectToken) {
    throw new Error("Falta el token de OpenProject");
  }
  const url = withQuery(apiUrl(config, path), params);
  return requestJson(url, { headers: headers(config) });
}

function activityIdFromHref(href) {
  const match = String(href || "").match(/\/activities\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

function collectActivityValues(node, path = "") {
  const found = [];
  if (!node || typeof node !== "object") {
    return found;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      found.push(...collectActivityValues(item, path));
    }
    return found;
  }

  if (Array.isArray(node.allowedValues) && path.toLowerCase().includes("activity")) {
    for (const value of node.allowedValues) {
      if (value && (value.href || value.title)) {
        found.push({
          href: value.href || "",
          title: value.title || "",
          id: activityIdFromHref(value.href)
        });
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    found.push(...collectActivityValues(value, `${path}.${key}`));
  }

  return found;
}

function uniqueActivities(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.id || ""}:${value.title}`;
    if (!value.title || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function getCurrentUser(config) {
  return opGet(config, "/users/me");
}

export async function getMyPreferences(config) {
  return opGet(config, "/my_preferences");
}

async function getOpenProjectTimeZone(config) {
  const fallback = browserTimeZone();
  try {
    const preferences = await getMyPreferences(config);
    const timeZone = preferences?.timeZone;
    if (!timeZone) {
      return fallback;
    }
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return fallback;
  }
}

export async function getProject(config) {
  if (!config.openprojectProjectId) {
    throw new Error("Falta el proyecto de OpenProject");
  }
  return opGet(config, `/projects/${encodeURIComponent(config.openprojectProjectId)}`);
}

export async function getWorkPackage(config) {
  if (!config.openprojectWorkPackageId) {
    throw new Error("Falta el work package de OpenProject");
  }
  return opGet(config, `/work_packages/${encodeURIComponent(config.openprojectWorkPackageId)}`);
}

async function getCollection(config, path, params = {}) {
  const elements = [];
  let offset = 1;

  while (offset <= 10) {
    const collection = await opGet(config, path, {
      ...params,
      pageSize: 100,
      offset
    });
    const page = collection?._embedded?.elements || [];
    elements.push(...page);
    const total = Number(collection?.total || elements.length);
    if (page.length === 0 || elements.length >= total) {
      break;
    }
    offset += 1;
  }

  return elements;
}

export async function getAvailableProjects(config) {
  const projects = await getCollection(config, "/time_entries/available_projects");
  return projects.map((project) => ({
    id: String(project.id),
    name: project.name,
    identifier: project.identifier || "",
    active: Boolean(project.active)
  }));
}

export async function getProjectWorkPackages(config, projectId) {
  if (!projectId) {
    throw new Error("Falta el proyecto de OpenProject");
  }

  const workPackages = await getCollection(
    config,
    `/projects/${encodeURIComponent(projectId)}/work_packages`
  );

  const mapped = workPackages.map((workPackage) => ({
    id: String(workPackage.id),
    code: String(workPackage.displayId || workPackage.id),
    subject: workPackage.subject || `WP ${workPackage.id}`,
    type: workPackage._links?.type?.title || "",
    status: workPackage._links?.status?.title || "",
    canLogTime: Boolean(workPackage._links?.logTime)
  }));

  const allowed = mapped.filter((workPackage) => workPackage.canLogTime);
  return allowed.length ? allowed : mapped;
}

export async function getTimeEntrySchema(config) {
  return opGet(config, "/time_entries/schema");
}

export async function getTimeEntryFormSchema(config) {
  if (!config.openprojectProjectId || !config.openprojectWorkPackageId) {
    throw new Error("Faltan el proyecto o el work package de OpenProject");
  }

  return requestJson(apiUrl(config, "/time_entries/form"), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({
      _links: {
        project: { href: `/api/v3/projects/${config.openprojectProjectId}` },
        entity: {
          href: `/api/v3/work_packages/${config.openprojectWorkPackageId}`
        }
      }
    })
  });
}

export async function detectActivity(config, name = "Development", { force = false } = {}) {
  if (config.openprojectActivityId && !force) {
    return {
      id: Number(config.openprojectActivityId),
      href: `/api/v3/time_entries/activities/${config.openprojectActivityId}`,
      title: name,
      activities: []
    };
  }

  let schema;
  try {
    schema = await getTimeEntryFormSchema(config);
  } catch {
    schema = await getTimeEntrySchema(config);
  }
  const activities = uniqueActivities(collectActivityValues(schema));
  const wanted = String(name || "").trim().toLowerCase();
  const selected = activities.find((activity) => activity.title.toLowerCase() === wanted);

  if (!selected || !selected.id) {
    const available = activities.map((activity) => activity.title).filter(Boolean).join(", ");
    throw new Error(
      `No encontré la actividad «${name}» en OpenProject.${available ? ` Disponibles: ${available}.` : ""}`
    );
  }

  return {
    id: selected.id,
    href: selected.href || `/api/v3/time_entries/activities/${selected.id}`,
    title: selected.title,
    activities
  };
}

function projectHrefMatches(entry, projectId) {
  const href = String(entry?._links?.project?.href || "");
  return href.endsWith(`/projects/${projectId}`) || href.includes(`/projects/${projectId}/`);
}

export async function getExistingEntries(config, date, user) {
  const filters = [
    { spent_on: { operator: "=d", values: [date] } },
    { user_id: { operator: "=", values: [String(user.id)] } }
  ];

  const collection = await opGet(config, "/time_entries", {
    pageSize: 100,
    filters: JSON.stringify(filters)
  });

  const entries = collection?._embedded?.elements || [];
  return entries.filter((entry) => projectHrefMatches(entry, config.openprojectProjectId));
}

function activityHref(config, activity) {
  if (activity?.href) {
    return activity.href;
  }
  return `/api/v3/time_entries/activities/${activity.id}`;
}

export async function createTimeEntry(config, { date, start, end, comment, activity }) {
  if (!comment || !comment.trim()) {
    throw new Error("El comentario no puede estar vacío");
  }

  const hours = rangeHours(start, end);

  const payload = {
    _type: "TimeEntry",
    spentOn: date,
    hours: hoursToDuration(hours),
    comment: { raw: comment.trim().slice(0, 1000) },
    _links: {
      project: { href: `/api/v3/projects/${config.openprojectProjectId}` },
      entity: { href: `/api/v3/work_packages/${config.openprojectWorkPackageId}` },
      activity: { href: activityHref(config, activity) }
    }
  };

  if (config.sendStartTime) {
    const mode = config.startTimeMode || "literal";
    if (mode === "openproject") {
      // Convierte la hora local a la zona del perfil de OpenProject.
      const timeZone = await getOpenProjectTimeZone(config);
      payload.startTime = zonedTimeToUTC(date, start, timeZone);
    } else if (mode === "browser") {
      // Convierte la hora local del navegador a UTC.
      payload.startTime = localDateTimeToUTC(date, start);
    } else {
      // Modo recomendado para esta instancia: conserva la hora tal cual,
      // igual que las entradas creadas desde la UI de OpenProject.
      payload.startTime = `${date}T${start}:00.000Z`;
    }
  }

  const requestBody = JSON.stringify(payload);

  try {
    return await requestJson(apiUrl(config, "/time_entries"), {
      method: "POST",
      headers: headers(config),
      body: requestBody
    });
  } catch (error) {
    if (String(error.message).includes("422")) {
      const links = Object.keys(payload._links).join(", ");
      throw new Error(`${error.message} | Campos enviados: ${links}`);
    }
    throw error;
  }
}

export async function testOpenProject(config) {
  const [user, project, workPackage] = await Promise.all([
    getCurrentUser(config),
    getProject(config),
    getWorkPackage(config)
  ]);
  let activity = null;
  let activityWarning = null;
  try {
    activity = await detectActivity(config, config.openprojectActivityName || "Development");
  } catch (error) {
    activityWarning = error.message;
  }
  return {
    user: user.name || user.login,
    project: project.name,
    workPackage: workPackage.subject || workPackage.name || config.openprojectWorkPackageId,
    activity: activity?.title || null,
    activityWarning
  };
}