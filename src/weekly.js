export function pairKey(date, projectId) {
  return `${date}|${projectId}`;
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
