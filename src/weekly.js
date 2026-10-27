export function pairKey(date, projectId) {
  return `${date}|${projectId}`;
}

export function durationToMinutes(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?$/.exec(String(value || ""));
  if (!match) {
    return null;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

// Rango visible de un fichaje existente: startTime es un instante UTC;
// se muestra en la zona del navegador y el fin se deriva de la duración.
export function loggedTimeRange(startTime, hours, timeZone) {
  const date = new Date(String(startTime || ""));
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const minutes = durationToMinutes(hours) ?? 0;
  const end = new Date(date.getTime() + minutes * 60000);
  const options = { hourCycle: "h23", hour: "2-digit", minute: "2-digit" };
  if (timeZone) {
    options.timeZone = timeZone;
  }
  const format = (value) => value.toLocaleTimeString("es-ES", options);
  return { start: format(date), end: format(end) };
}

export function hrefMatchesProject(href, projectId) {
  const value = String(href || "");
  return value.endsWith(`/projects/${projectId}`) || value.includes(`/projects/${projectId}/`);
}

// Divide los entries en: por día para el proyecto objetivo (control de
// duplicados) y por día para todos los proyectos (mostrar en la tarjeta).
export function splitExisting(entries, targetProject) {
  const byDate = {};
  const allByDate = {};
  for (const entry of entries) {
    const date = String(entry?.spentOn || "").slice(0, 10);
    if (!date) {
      continue;
    }
    if (!allByDate[date]) {
      allByDate[date] = [];
    }
    allByDate[date].push(entry);
    if (!targetProject || hrefMatchesProject(entry?._links?.project?.href, targetProject)) {
      if (!byDate[date]) {
        byDate[date] = [];
      }
      byDate[date].push(entry);
    }
  }
  return { byDate, allByDate };
}

// Extrae los campos visibles de un time entry de OpenProject (HAL).
export function parseLoggedEntry(entry) {
  const links = entry?._links || {};
  const projectHref = String(links.project?.href || "");
  const entityHref = String(links.entity?.href || "");
  return {
    id: entry?.id,
    date: String(entry?.spentOn || "").slice(0, 10),
    projectId: /\/projects\/(\d+)/.exec(projectHref)?.[1] || "",
    workPackageId: /\/work_packages\/(\d+)/.exec(entityHref)?.[1] || "",
    entityHref: entityHref,
    hours: String(entry?.hours || ""),
    startTime: String(entry?.startTime || ""),
    comment: String(entry?.comment?.raw || "")
  };
}

export function normalizeWorkPackageQuery(value) {
  return String(value || "").trim().toLowerCase().replace(/^#/, "");
}

export function filterWorkPackages(packages, query) {
  const items = Array.isArray(packages) ? packages : [];
  const normalized = normalizeWorkPackageQuery(query);
  if (!normalized) {
    return items;
  }
  return items.filter((workPackage) => {
    const haystack = `${workPackage.code || workPackage.id} ${workPackage.subject} ${
      workPackage.status || ""
    } ${workPackage.type || ""}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

// Selección automática solo con coincidencia exacta de código o asunto.
export function autoSelectWorkPackage(packages, query) {
  const items = Array.isArray(packages) ? packages : [];
  const normalized = normalizeWorkPackageQuery(query);
  if (!normalized) {
    return null;
  }
  const exact = items.filter((workPackage) => {
    const code = String(workPackage.code || workPackage.id || "").toLowerCase();
    const subject = String(workPackage.subject || "").toLowerCase();
    return code === normalized || subject === normalized;
  });
  return exact.length === 1 ? exact[0] : null;
}

// Política "consumir existentes": si un (día, proyecto) ya tiene N fichajes
// previos, las primeras N líneas no-extra de ese par se omiten. Las líneas
// marcadas allowExisting (añadidas a propósito o reincluidas por el usuario)
// sí se crean.
export function planEntryActions(entries, existingIdsByPair) {
  const toCreate = [];
  const skipped = [];
  const budget = new Map();

  for (const entry of entries) {
    const key = pairKey(entry.date, entry.projectId);
    if (!budget.has(key)) {
      budget.set(key, (existingIdsByPair.get(key) || []).length);
    }
    const remaining = budget.get(key);
    if (remaining > 0 && !entry.allowExisting) {
      budget.set(key, remaining - 1);
      const ids = existingIdsByPair.get(key) || [];
      skipped.push({
        lineId: entry.lineId,
        date: entry.date,
        reason: `Ya existía un fichaje (ID ${ids.join(", ")})`
      });
      continue;
    }
    toCreate.push(entry);
  }

  return { toCreate, skipped };
}
