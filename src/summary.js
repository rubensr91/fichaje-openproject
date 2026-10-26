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

export function fallbackSummary(evidence, projectName = "") {
  const data = normalizeEvidence(evidence);
  const titles = uniqueTitles(
    [
      ...data.commits.map((commit) => commit.title),
      ...data.mergeRequests.map((mr) => `!${mr.iid} ${mr.title}`),
      ...data.issues.map((issue) => `#${issue.iid} ${issue.title}`)
    ],
    8
  );

  if (titles.length === 0) {
    return "Sin actividad registrada en GitLab para este día.";
  }

  const prefix = projectName ? `${projectName}: ` : "";
  return `${prefix}\n${titles.map((title) => `• ${title}`).join("\n")}`;
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

export function buildLlmMessages(evidence, date, projectName) {
  return [
    {
      role: "system",
      content:
        "Redactas partes de trabajo diarios en español para una herramienta de fichaje. " +
        "Resume únicamente el trabajo evidenciado en los datos. No inventes tareas, no menciones horas y no des consejos. " +
        "Devuelve solo el texto del resumen, en 2 a 5 líneas, con viñetas si ayuda. Sé concreto y técnico."
    },
    {
      role: "user",
      content: buildEvidenceText(evidence, date, projectName)
    }
  ];
}