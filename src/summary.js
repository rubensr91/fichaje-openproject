function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function uniqueTitles(items, limit) {
  const seen = new Set();
  const titles = [];
  for (const item of items) {
    const title = clean(item);
    if (!title || seen.has(title.toLowerCase())) {
      continue;
    }
    seen.add(title.toLowerCase());
    titles.push(title);
    if (titles.length >= limit) {
      break;
    }
  }
  return titles;
}

export function normalizeEvidence(evidence = {}) {
  const commits = Array.isArray(evidence.commits) ? evidence.commits : [];
  const mergeRequests = Array.isArray(evidence.mergeRequests) ? evidence.mergeRequests : [];
  const issues = Array.isArray(evidence.issues) ? evidence.issues : [];

  return {
    commits: commits.map((commit) => ({
      title: truncate(commit.title || commit.message, 180),
      message: truncate(commit.message, 400),
      author: clean(commit.author_name),
      url: commit.web_url || ""
    })),
    mergeRequests: mergeRequests.map((mr) => ({
      iid: mr.iid,
      title: truncate(mr.title, 180),
      description: truncate(mr.description, 400),
      state: clean(mr.state),
      url: mr.web_url || ""
    })),
    issues: issues.map((issue) => ({
      iid: issue.iid,
      title: truncate(issue.title, 180),
      description: truncate(issue.description, 300),
      state: clean(issue.state),
      url: issue.web_url || ""
    }))
  };
}

function groupByProjectPrefix(titles) {
  const groups = new Map();
  for (const title of titles) {
    const match = /^\[([^\]]+)\]\s*(.*)$/.exec(title);
    const key = match ? match[1] : "";
    const rest = match ? match[2] : title;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(rest);
  }
  return groups;
}

export function fallbackSummary(evidence, projectName = "") {
  const data = normalizeEvidence(evidence);
  const titles = uniqueTitles(
    [
      ...data.commits.map((commit) => commit.title),
      ...data.mergeRequests.map((mr) => `!${mr.iid} ${mr.title}`),
      ...data.issues.map((issue) => `#${issue.iid} ${issue.title}`)
    ],
    12
  );

  if (titles.length === 0) {
    return "Sin actividad registrada en GitLab para este día.";
  }

  const groups = groupByProjectPrefix(titles);
  if (groups.size === 1 && groups.has("")) {
    const prefix = projectName ? `${projectName}: ` : "";
    return `${prefix}\n${[...groups.values()][0].map((title) => `• ${title}`).join("\n")}`;
  }

  const blocks = [];
  for (const [project, items] of groups) {
    blocks.push(`**${project || projectName || "General"}**`);
    blocks.push(...items.map((title) => `• ${title}`));
    blocks.push("");
  }
  return blocks.join("\n").trim();
}

export function buildEvidenceText(evidence, date, projectName) {
  const data = normalizeEvidence(evidence);
  const lines = [`Fecha: ${date}`, `Proyecto: ${projectName || "GitLab"}`];

  if (data.commits.length) {
    lines.push("", "Commits:");
    for (const commit of data.commits) {
      lines.push(`- ${commit.title}${commit.message && commit.message !== commit.title ? ` | ${commit.message}` : ""}`);
    }
  }

  if (data.mergeRequests.length) {
    lines.push("", "Merge requests:");
    for (const mr of data.mergeRequests) {
      lines.push(`- !${mr.iid} ${mr.title} [${mr.state}]${mr.description ? ` | ${mr.description}` : ""}`);
    }
  }

  if (data.issues.length) {
    lines.push("", "Issues:");
    for (const issue of data.issues) {
      lines.push(`- #${issue.iid} ${issue.title} [${issue.state}]${issue.description ? ` | ${issue.description}` : ""}`);
    }
  }

  return truncate(lines.join("\n"), 9000);
}

export function buildLlmMessagesFromText(evidenceText) {
  return [
    {
      role: "system",
      content:
        "Redactas partes de trabajo diarios en español para una herramienta de fichaje. " +
        "Resume únicamente el trabajo evidenciado en los datos y cita tareas, commits o incidencias " +
        "concretas de la lista. No inventes tareas, no uses frases genéricas, no repitas el mismo " +
        "resumen entre días distintos, no menciones horas y no des consejos. " +
        "Si los datos contienen actividad de varios proyectos (cada elemento va marcado como [proyecto]), " +
        "agrupa el resumen por proyecto con un apartado por proyecto en el mismo orden en que aparecen. " +
        "Si solo hay un proyecto, resume como de costumbre. " +
        "Si el día no tiene ningún elemento, responde exactamente: Sin actividad registrada en GitLab para este día. " +
        "Devuelve solo el texto del resumen, en 2 a 6 líneas, con viñetas si ayuda. Sé concreto y técnico."
    },
    {
      role: "user",
      content: evidenceText
    }
  ];
}

export function buildLlmMessages(evidence, date, projectName) {
  return buildLlmMessagesFromText(buildEvidenceText(evidence, date, projectName));
}