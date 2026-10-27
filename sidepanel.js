import { DEFAULT_CONFIG, getConfig, isConfigured, saveConfig } from "./src/config.js";
import {
  ensureMigrated,
  forgetSecrets,
  getSecretStatus,
  getSecrets,
  lock,
  mergeSecrets,
  saveSecrets,
  setupVault,
  switchToSession,
  unlock
} from "./src/secrets.js";
import {
  defaultWeekRange,
  enumerateDates,
  formatDurationISO,
  formatHours,
  rangeHours,
  todayISO
} from "./src/time.js";
import { autoSelectWorkPackage, filterWorkPackages } from "./src/weekly.js";

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  secretStatus: null,
  evidence: null,
  existing: [],
  projects: [],
  workPackages: [],
  posted: false,
  busy: false,
  mode: "daily",
  weekly: { dates: [], days: [] }
};

function setStatus(text, kind = "") {
  const box = $("statusBox");
  box.textContent = text || "";
  box.className = `status ${kind} ${text ? "" : "hidden"}`.trim();
}

function setSettingsStatus(text, kind = "") {
  const box = $("settingsStatus");
  box.textContent = text || "";
  box.className = `hint ${kind}`.trim();
}

function currentRange() {
  try {
    const hours = rangeHours($("start").value, $("end").value);
    $("hoursValue").textContent = formatHours(hours);
    $("rangeError").classList.add("hidden");
    return hours;
  } catch (error) {
    $("hoursValue").textContent = "—";
    $("rangeError").textContent = error.message;
    $("rangeError").classList.remove("hidden");
    return null;
  }
}

function secretsUsable() {
  const status = state.secretStatus;
  if (!status?.hasSecrets) {
    return false;
  }
  return status.mode !== "vault" || status.unlocked;
}

function updateSetupNotice() {
  $("setupNotice").classList.toggle(
    "hidden",
    Boolean(state.config && isConfigured(state.config) && secretsUsable())
  );
}

function renderProjectOptions(projects, selectedId, message = "Selecciona proyecto") {
  const select = $("projectSelect");
  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = projects.length ? message : "Sin proyectos disponibles";
  select.append(placeholder);

  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    select.append(option);
  }

  if (selectedId && projects.some((project) => project.id === String(selectedId))) {
    select.value = String(selectedId);
  }
}

function renderWorkPackageOptions(workPackages, selectedId, message = "Selecciona work package") {
  const select = $("wpSelect");
  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = workPackages.length ? message : "Sin work packages";
  select.append(placeholder);

  for (const workPackage of workPackages) {
    const option = document.createElement("option");
    option.value = workPackage.id;
    const status = workPackage.status ? ` [${workPackage.status}]` : "";
    const code = workPackage.code || workPackage.id;
    option.textContent = `#${code} · ${workPackage.subject}${status}`;
    select.append(option);
  }

  if (selectedId && workPackages.some((workPackage) => workPackage.id === String(selectedId))) {
    select.value = String(selectedId);
  }
}

function workPackageQuery() {
  return $("wpSearch").value.trim().toLowerCase().replace(/^#/, "");
}

function matchingWorkPackages() {
  const query = workPackageQuery();
  if (!query) {
    return state.workPackages;
  }
  return state.workPackages.filter((workPackage) => {
    const haystack = `${workPackage.code || workPackage.id} ${workPackage.subject} ${
      workPackage.status || ""
    } ${workPackage.type || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function refreshWorkPackageOptions() {
  const query = workPackageQuery();
  const matching = matchingWorkPackages();
  const selectedId = state.config?.openprojectWorkPackageId;
  let visible = matching;

  // Mantén la tarea seleccionada visible aunque no coincida con la búsqueda.
  if (selectedId && !visible.some((workPackage) => workPackage.id === String(selectedId))) {
    const selected = state.workPackages.find(
      (workPackage) => workPackage.id === String(selectedId)
    );
    if (selected) {
      visible = [selected, ...visible];
    }
  }

  renderWorkPackageOptions(
    visible,
    selectedId,
    query ? "Sin coincidencias" : "Selecciona work package"
  );

  const total = state.workPackages.length;
  if (!total) {
    $("wpCount").textContent = "";
  } else if (query) {
    $("wpCount").textContent = `${matching.length} de ${total} tareas`;
  } else {
    $("wpCount").textContent = `${total} tareas`;
  }
}

function syncSelectionFields() {
  $("openprojectProjectId").value = state.config?.openprojectProjectId || "";
  $("openprojectWorkPackageId").value = state.config?.openprojectWorkPackageId || "";
  updateSetupNotice();
  refreshPostButton();
}

async function loadWorkPackages(projectId, selectedWpId = "") {
  state.workPackages = [];
  $("wpSearch").value = "";
  $("wpCount").textContent = "";
  renderWorkPackageOptions([], "", "Cargando work packages...");
  if (!projectId) {
    renderWorkPackageOptions([], "", "Selecciona un proyecto");
    return;
  }

  try {
    const workPackages = await send({ type: "LIST_WORK_PACKAGES", projectId });
    state.workPackages = workPackages;
    refreshWorkPackageOptions();

    const selected = $("wpSelect").value;
    if (state.config.openprojectWorkPackageId && selected !== String(state.config.openprojectWorkPackageId)) {
      state.config = await saveConfig({
        openprojectProjectId: projectId,
        openprojectWorkPackageId: ""
      });
      syncSelectionFields();
    }
  } catch (error) {
    renderWorkPackageOptions([], "", "Error al cargar work packages");
    setStatus(error.message, "error");
  }
}

async function loadProjects() {
  if (!secretsUsable()) {
    const message =
      state.secretStatus?.mode === "vault" && !state.secretStatus?.unlocked
        ? "Desbloquea la caja de tokens"
        : "Configura los tokens de OpenProject";
    renderProjectOptions([], "", message);
    renderWorkPackageOptions([], "", "Selecciona un proyecto");
    return;
  }

  renderProjectOptions([], "", "Cargando proyectos...");
  try {
    const projects = await send({ type: "LIST_PROJECTS" });
    state.projects = projects;
    renderProjectOptions(projects, state.config.openprojectProjectId);
    if (state.weekly.days.length) {
      renderWeekDays();
    }
    const projectId = $("projectSelect").value;
    if (projectId) {
      await loadWorkPackages(projectId, state.config.openprojectWorkPackageId);
    } else {
      renderWorkPackageOptions([], "", "Selecciona un proyecto");
    }
  } catch (error) {
    renderProjectOptions([], "", "Error al cargar proyectos");
    setStatus(error.message, "error");
  }
}

function eachLine(callback) {
  for (const day of state.weekly.days) {
    for (const line of day.lines) {
      callback(day, line);
    }
  }
}

function weeklyEligibleLines() {
  const result = [];
  eachLine((day, line) => {
    if (
      line.include &&
      !line.posted &&
      line.text.trim() &&
      line.opProjectId &&
      line.wpId &&
      dayHours(line) !== null
    ) {
      result.push({ day, line });
    }
  });
  return result;
}

function dayHours(target) {
  try {
    return rangeHours(target.start, target.end);
  } catch {
    return null;
  }
}

function dayHoursError(target) {
  return dayHours(target) === null
    ? "Tramo no válido: el fin debe ser posterior a la hora de inicio."
    : null;
}

function weekProjectLabel(projectId) {
  const project = state.projects.find((item) => item.id === String(projectId));
  return project ? project.name : `Proyecto ${projectId}`;
}

function weekWorkPackages(projectId) {
  return state.weekly.wpCache?.[String(projectId)] || null;
}

function weekWorkPackageLabel(target) {
  const workPackages = weekWorkPackages(target.opProjectId) || state.workPackages;
  const workPackage = workPackages.find((item) => item.id === String(target.wpId));
  if (!workPackage) {
    return `#${target.wpId}`;
  }
  return `#${workPackage.code || workPackage.id} · ${workPackage.subject}`;
}

async function loadWeekWorkPackages(projectId) {
  const key = String(projectId);
  if (!key) {
    return [];
  }
  if (!state.weekly.wpCache) {
    state.weekly.wpCache = {};
  }
  if (state.weekly.wpCache[key]) {
    return state.weekly.wpCache[key];
  }
  const workPackages = await send({ type: "LIST_WORK_PACKAGES", projectId: key });
  state.weekly.wpCache[key] = workPackages;
  return workPackages;
}

function propagateGlobalHours() {
  if (!state.weekly.days.length) {
    return;
  }
  let changed = false;
  eachLine((day, line) => {
    if (line.posted || line.hoursEdited) {
      return;
    }
    line.start = $("start").value;
    line.end = $("end").value;
    changed = true;
  });
  if (changed) {
    for (const day of state.weekly.days) {
      repaintWeekDay(day);
    }
  }
}

function propagateGlobalWorkPackage() {
  if (!state.weekly.days.length) {
    return;
  }
  const projectId = String(state.config?.openprojectProjectId || "");
  const wpId = state.config?.openprojectWorkPackageId || "";
  let changed = false;
  eachLine((day, line) => {
    if (line.posted || line.projectEdited || line.wpEdited) {
      return;
    }
    if (String(line.opProjectId) === projectId && line.wpId !== wpId) {
      line.wpId = wpId;
      changed = true;
    }
  });
  if (changed) {
    for (const day of state.weekly.days) {
      repaintWeekDay(day);
    }
  }
}

function propagateGlobalProject() {
  if (!state.weekly.days.length) {
    return;
  }
  const projectId = String(state.config?.openprojectProjectId || "");
  let changed = false;
  eachLine((day, line) => {
    if (line.posted || line.projectEdited) {
      return;
    }
    if (String(line.opProjectId) !== projectId) {
      line.opProjectId = projectId;
      line.wpId = state.config?.openprojectWorkPackageId || "";
      line.preExisting = false;
      line.skipReason = null;
      line.include = day.hasActivity && Boolean(projectId);
      changed = true;
    }
  });
  if (changed) {
    for (const day of state.weekly.days) {
      repaintWeekDay(day);
    }
  }
}

function refreshPostButton() {
  $("postBtn").disabled =
    state.busy ||
    weeklyEligibleLines().length === 0 ||
    !isConfigured(state.config || {}) ||
    !secretsUsable();
}

function resetResult() {
  state.evidence = null;
  state.existing = [];
  state.posted = false;
  $("postBtn").textContent = "Fichar";
  refreshPostButton();
}
function populateSettings(config) {
  $("gitlabBaseUrl").value = config.gitlabBaseUrl;
  $("gitlabMode").value = config.gitlabMode || "all";
  $("gitlabProject").value = config.gitlabProject;
  $("gitlabAuthor").value = config.gitlabAuthor;

  $("openprojectBaseUrl").value = config.openprojectBaseUrl;
  $("openprojectProjectId").value = config.openprojectProjectId;
  $("openprojectWorkPackageId").value = config.openprojectWorkPackageId;
  $("openprojectActivityName").value = config.openprojectActivityName || "Development";
  $("openprojectActivityId").value = config.openprojectActivityId;
  $("sendStartTime").checked = Boolean(config.sendStartTime);
  $("startTimeMode").value = config.startTimeMode || "browser";

  $("llmBaseUrl").value = config.llmBaseUrl;
  $("llmModel").value = config.llmModel;
  $("llmFilterMode").value = config.llmFilterMode || "redact";
  $("gitlabToken").value = "";
  $("openprojectToken").value = "";
  $("llmApiKey").value = "";
}

function applySecretStatus(status) {
  state.secretStatus = status;
  const locked = status.mode === "vault" && !status.unlocked;

  const placeholder = locked
    ? "Bloqueado"
    : status.hasSecrets
      ? "Guardado (deja vacío para conservar)"
      : "Pega el token";

  for (const id of ["gitlabToken", "openprojectToken", "llmApiKey"]) {
    $(id).placeholder = placeholder;
    $(id).disabled = locked;
    if (locked) {
      $(id).value = "";
    }
  }

  if (status.mode === "vault") {
    $("secretStatusText").textContent = status.unlocked
      ? "Caja cifrada desbloqueada. Se bloquea a los 15 minutos."
      : status.vaultExists
        ? "Caja cifrada bloqueada. Introduce la contraseña."
        : "No hay caja cifrada.";
  } else {
    $("secretStatusText").textContent = status.hasSecrets
      ? "Solo esta sesión. Los tokens desaparecen al cerrar el navegador."
      : "Sin tokens guardados. Se piden al configurar.";
  }

  $("lockedBanner").classList.toggle(
    "hidden",
    !(status.mode === "vault" && status.vaultExists && !status.unlocked)
  );
  if (status.unlocked) {
    $("quickUnlockPassword").value = "";
    $("quickUnlockError").classList.add("hidden");
  }

  $("vaultLocked").classList.toggle(
    "hidden",
    !(status.mode === "vault" && status.vaultExists && !status.unlocked)
  );
  $("vaultSetup").classList.toggle("hidden", status.mode === "vault");
  $("vaultUnlocked").classList.toggle(
    "hidden",
    !(status.mode === "vault" && status.unlocked)
  );

  updateSetupNotice();
  refreshPostButton();
}

function readEnteredSecrets() {
  const entered = {};
  if ($("gitlabToken").value.trim()) {
    entered.gitlabToken = $("gitlabToken").value.trim();
  }
  if ($("openprojectToken").value.trim()) {
    entered.openprojectToken = $("openprojectToken").value.trim();
  }
  if ($("llmApiKey").value.trim()) {
    entered.llmApiKey = $("llmApiKey").value.trim();
  }
  return entered;
}

function readSettings() {
  const current = state.config || DEFAULT_CONFIG;
  return {
    gitlabBaseUrl: $("gitlabBaseUrl").value.trim(),
    gitlabProject: $("gitlabProject").value.trim(),
    gitlabAuthor: $("gitlabAuthor").value.trim(),
    gitlabMode: $("gitlabMode").value || "all",
    openprojectBaseUrl: $("openprojectBaseUrl").value.trim(),
    openprojectProjectId: $("openprojectProjectId").value.trim(),
    openprojectWorkPackageId: $("openprojectWorkPackageId").value.trim(),
    openprojectActivityName: $("openprojectActivityName").value.trim() || "Development",
    openprojectActivityId: $("openprojectActivityId").value.trim(),
    sendStartTime: $("sendStartTime").checked,
    startTimeMode: $("startTimeMode").value || "browser",
    llmBaseUrl: $("llmBaseUrl").value.trim(),
    llmModel: $("llmModel").value.trim(),
    llmFilterMode: $("llmFilterMode").value || "redact",
    defaultStart: $("start").value || current.defaultStart,
    defaultEnd: $("end").value || current.defaultEnd
  };
}

function validateUrls(settings) {
  const urls = [
    ["GitLab", settings.gitlabBaseUrl],
    ["OpenProject", settings.openprojectBaseUrl]
  ];
  if (settings.llmBaseUrl) {
    urls.push(["LLM", settings.llmBaseUrl]);
  }

  for (const [label, value] of urls) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`URL de ${label} no válida`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`URL de ${label} no válida`);
    }
  }
}

function ensureOriginPermission(baseUrl) {
  const url = new URL(baseUrl);
  const origin = `${url.protocol}//${url.host}/*`;
  return chrome.permissions.request({ origins: [origin] });
}

async function saveSettings({ silent = false } = {}) {
  const settings = readSettings();
  validateUrls(settings);

  const origins = [
    settings.gitlabBaseUrl,
    settings.openprojectBaseUrl,
    settings.llmBaseUrl
  ].filter(Boolean);
  const permissions = await Promise.all(origins.map(ensureOriginPermission));
  if (permissions.some((granted) => !granted)) {
    throw new Error("No se concedió permiso para acceder a alguna de las URLs");
  }

  state.config = await saveConfig(settings);

  const entered = readEnteredSecrets();
  if (Object.keys(entered).length) {
    await saveSecrets(entered);
    $("gitlabToken").value = "";
    $("openprojectToken").value = "";
    $("llmApiKey").value = "";
  }

  state.secretStatus = await getSecretStatus();
  applySecretStatus(state.secretStatus);
  syncSelectionFields();
  if (!silent) {
    setSettingsStatus("Ajustes guardados.");
  }
  return state.config;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Error desconocido");
  }
  return response.data;
}

function resetWeekly() {
  state.weekly = { dates: [], days: [], wpCache: {}, lineSeq: 0 };
  $("weeklyDays").replaceChildren();
  $("weeklyProgress").textContent = "";
  $("weeklySection").classList.add("hidden");
  refreshPostButton();
}

function setMode(mode) {
  if (state.busy) {
    return;
  }
  state.mode = mode;
  const weekly = mode === "weekly";
  $("modeDaily").classList.toggle("active", !weekly);
  $("modeWeekly").classList.toggle("active", weekly);
  $("dateField").classList.toggle("hidden", weekly);
  $("weekFields").classList.toggle("hidden", !weekly);
  $("weekHint").classList.toggle("hidden", !weekly);
  $("generateBtn").textContent = weekly ? "Generar resúmenes" : "Generar resumen";
  $("postBtn").textContent = "Fichar";
  state.posted = false;
  resetResult();
  resetWeekly();
  setStatus("");
}

function weekdayLabel(dateISO) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short"
  });
}

function makeLine(overrides = {}) {
  state.weekly.lineSeq += 1;
  return {
    id: `line-${state.weekly.lineSeq}`,
    include: true,
    start: $("start").value || state.config?.defaultStart || "08:00",
    end: $("end").value || state.config?.defaultEnd || "15:15",
    hoursEdited: false,
    opProjectId: String(state.config?.openprojectProjectId || ""),
    projectEdited: false,
    wpId: state.config?.openprojectWorkPackageId || "",
    wpEdited: false,
    wpSearch: "",
    text: "",
    textEdited: false,
    preExisting: false,
    extra: false,
    posted: false,
    postedId: null,
    postedHours: null,
    error: null,
    skipReason: null,
    loadError: null,
    ...overrides
  };
}

function buildDays(dates, evidenceByDate, existingByDate, existingError) {
  state.weekly.dates = dates;
  state.weekly.wpCache = {};
  if (state.config.openprojectProjectId) {
    state.weekly.wpCache[String(state.config.openprojectProjectId)] = state.workPackages;
  }
  state.weekly.days = dates.map((date) => {
    const evidence = evidenceByDate[date];
    const existingEntries = existingByDate[date] || [];
    const counts = evidence?.counts || {};
    const hasActivity =
      (counts.commits || 0) + (counts.mergeRequests || 0) + (counts.issues || 0) > 0;
    const firstLine = makeLine({
      preExisting: existingEntries.length > 0,
      include: hasActivity && existingEntries.length === 0
    });
    if (existingEntries.length) {
      firstLine.skipReason = `Ya existía un fichaje para este día y proyecto (ID ${existingEntries
        .map((entry) => entry.id)
        .join(", ")}). Desmárcalo o crea una tarea aparte.`;
    }
    return {
      date,
      evidence,
      hasActivity,
      existing: existingEntries,
      warnings: [
        evidence?.warning,
        existingError ? `No se pudo comprobar si ya había fichajes (${existingError}).` : null
      ].filter(Boolean),
      lines: [firstLine]
    };
  });
}

function renderWeekLine(day, line) {
  const wrap = document.createElement("div");
  wrap.className = `week-line${line.posted ? " done" : ""}${line.error ? " error" : ""}`;

  const head = document.createElement("div");
  head.className = "week-line-head";

  const check = document.createElement("label");
  check.className = "week-line-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = line.include;
  checkbox.disabled = line.posted;
  checkbox.addEventListener("change", () => {
    line.include = checkbox.checked;
    repaintWeekDay(day);
  });
  const checkText = document.createElement("span");
  checkText.textContent = line.posted
    ? "Fichado"
    : line.preExisting && !line.include
      ? "Existente (desmarcado)"
      : line.extra
        ? "Fichar esta tarea"
        : "Fichar este día";
  check.append(checkbox, checkText);

  const status = document.createElement("span");
  status.className = "week-badges";
  if (line.posted) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = line.postedHours
      ? `ID ${line.postedId} · ${formatDurationISO(line.postedHours)}`
      : `ID ${line.postedId}`;
    status.append(badge);
  } else if (line.skipReason) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Omitido";
    status.append(badge);
  }
  if (line.extra) {
    const tag = document.createElement("span");
    tag.className = "badge";
    tag.textContent = "+ tarea";
    status.append(tag);
  }

  head.append(check, status);

  if (day.lines.length > 1 && !line.posted) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button ghost small week-line-remove";
    removeBtn.textContent = "Quitar";
    removeBtn.addEventListener("click", () => {
      day.lines = day.lines.filter((item) => item.id !== line.id);
      repaintWeekDay(day);
      refreshPostButton();
    });
    head.append(removeBtn);
  }

  const fields = document.createElement("div");
  fields.className = "field-row";

  const startField = document.createElement("label");
  startField.className = "field";
  const startSpan = document.createElement("span");
  startSpan.textContent = "Inicio";
  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.step = 900;
  startInput.value = line.start;
  startInput.disabled = line.posted;
  startInput.addEventListener("change", () => {
    line.start = startInput.value;
    line.hoursEdited = true;
    repaintWeekDay(day);
  });
  startField.append(startSpan, startInput);

  const endField = document.createElement("label");
  endField.className = "field";
  const endSpan = document.createElement("span");
  endSpan.textContent = "Fin";
  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.step = 900;
  endInput.value = line.end;
  endInput.disabled = line.posted;
  endInput.addEventListener("change", () => {
    line.end = endInput.value;
    line.hoursEdited = true;
    repaintWeekDay(day);
  });
  endField.append(endSpan, endInput);

  const duration = document.createElement("p");
  duration.className = "hint";
  const hours = dayHours(line);
  duration.textContent = hours === null ? "Tramo no válido" : `Total: ${formatHours(hours)}`;

  fields.append(startField, endField);

  const warn = document.createElement("p");
  warn.className = "week-warn";

  function refreshWarn() {
    const warnItems = [
      line.skipReason,
      line.error,
      line.loadError,
      line.posted ? null : dayHoursError(line),
      !line.posted && line.opProjectId && !line.wpId ? "Selecciona la tarea de esta fila." : null,
      !line.posted && !line.opProjectId ? "Selecciona el proyecto de esta fila." : null
    ].filter(Boolean);
    if (warnItems.length) {
      warn.textContent = warnItems.join(" ");
    } else {
      warn.textContent = "";
      warn.classList.add("hidden");
    }
    if (warnItems.length) {
      warn.classList.remove("hidden");
    }
  }

  const targetRow = document.createElement("div");
  targetRow.className = "week-line-targets";

  const projectField = document.createElement("div");
  projectField.className = "field";
  const projectSpan = document.createElement("span");
  projectSpan.textContent = "Proyecto OpenProject";
  const projectSelect = document.createElement("select");
  projectSelect.disabled = line.posted || !state.projects.length;
  const projectPlaceholder = document.createElement("option");
  projectPlaceholder.value = "";
  projectPlaceholder.textContent = state.projects.length
    ? "Selecciona proyecto"
    : "Sin proyectos disponibles";
  projectSelect.append(projectPlaceholder);
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.append(option);
  }
  if (line.opProjectId && !state.projects.some((project) => project.id === line.opProjectId)) {
    const option = document.createElement("option");
    option.value = line.opProjectId;
    option.textContent = weekProjectLabel(line.opProjectId);
    projectSelect.append(option);
  }
  projectSelect.value = line.opProjectId;
  projectSelect.addEventListener("change", async () => {
    line.opProjectId = projectSelect.value;
    line.projectEdited = true;
    line.wpId = "";
    line.wpSearch = "";
    line.loadError = null;
    repaintWeekDay(day);
    if (line.opProjectId) {
      try {
        await loadWeekWorkPackages(line.opProjectId);
      } catch (error) {
        line.loadError = `No se pudieron cargar las tareas: ${error.message}`;
      }
      repaintWeekDay(day);
      refreshPostButton();
    }
  });
  projectField.append(projectSpan, projectSelect);

  const wpField = document.createElement("div");
  wpField.className = "field";
  const wpSpan = document.createElement("span");
  wpSpan.textContent = "Tarea";
  const wpSearch = document.createElement("input");
  wpSearch.type = "search";
  wpSearch.autocomplete = "off";
  wpSearch.placeholder = "Buscar por código, asunto o estado...";
  wpSearch.value = line.wpSearch || "";
  wpSearch.disabled = line.posted || !line.opProjectId;

  const wpSelect = document.createElement("select");

  function fillTaskSelect() {
    const packages = weekWorkPackages(line.opProjectId);
    const matching = filterWorkPackages(packages || [], line.wpSearch);
    let visible = matching;
    if (
      line.wpId &&
      (packages || []).length &&
      !visible.some((item) => item.id === line.wpId)
    ) {
      const selected = (packages || []).find((item) => item.id === line.wpId);
      if (selected) {
        visible = [selected, ...visible];
      }
    }

    wpSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = !line.opProjectId
      ? "Selecciona un proyecto"
      : packages === null
        ? "Cargando tareas..."
        : matching.length
          ? (line.wpSearch ? "Sin coincidencias" : "Selecciona tarea")
          : packages.length
            ? "Sin coincidencias"
            : "Sin work packages";
    wpSelect.append(placeholder);

    for (const workPackage of visible) {
      const option = document.createElement("option");
      option.value = workPackage.id;
      const status = workPackage.status ? ` [${workPackage.status}]` : "";
      const code = workPackage.code || workPackage.id;
      option.textContent = `#${code} · ${workPackage.subject}${status}`;
      wpSelect.append(option);
    }

    if (line.wpId && !visible.some((item) => item.id === line.wpId)) {
      const option = document.createElement("option");
      option.value = line.wpId;
      option.textContent = `#${line.wpId}`;
      wpSelect.append(option);
    }
    wpSelect.value = line.wpId;
  }

  wpSearch.addEventListener("input", () => {
    line.wpSearch = wpSearch.value;
    const packages = weekWorkPackages(line.opProjectId) || [];
    const match = autoSelectWorkPackage(packages, wpSearch.value);
    if (match) {
      line.wpId = match.id;
      line.wpEdited = true;
    }
    fillTaskSelect();
    refreshWarn();
    refreshPostButton();
  });

  wpSelect.disabled = line.posted || !line.opProjectId;
  wpSelect.addEventListener("change", () => {
    line.wpId = wpSelect.value;
    line.wpEdited = true;
    fillTaskSelect();
    refreshWarn();
    refreshPostButton();
  });

  wpField.append(wpSpan, wpSearch, wpSelect);
  targetRow.append(projectField, wpField);

  const textarea = document.createElement("textarea");
  textarea.className = "week-summary";
  textarea.rows = 4;
  textarea.value = line.text;
  textarea.placeholder = "Resumen de esta tarea...";
  textarea.disabled = line.posted;
  textarea.addEventListener("input", () => {
    line.text = textarea.value;
    line.textEdited = true;
    refreshPostButton();
  });

  fillTaskSelect();
  refreshWarn();

  wrap.append(head, fields, duration, targetRow, textarea, warn);
  return wrap;
}

function renderWeekDay(day) {
  const card = document.createElement("div");
  card.className = "week-day";
  card.dataset.date = day.date;

  const head = document.createElement("div");
  head.className = "week-day-head";
  const title = document.createElement("strong");
  title.textContent = weekdayLabel(day.date);
  head.append(title);

  const counts = day.evidence?.counts || {};
  const badges = document.createElement("span");
  badges.className = "week-badges";
  badges.textContent = `${counts.commits || 0} commits · ${counts.mergeRequests || 0} MRs · ${
    counts.issues || 0
  } issues`;
  head.append(badges);

  const dayWarn = document.createElement("p");
  dayWarn.className = "week-warn";
  if (day.warnings.length) {
    dayWarn.textContent = day.warnings.join(" ");
  } else {
    dayWarn.classList.add("hidden");
  }

  card.append(head, dayWarn);

  if (!day.hasActivity && day.lines.length === 1 && !day.lines[0].textEdited) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent =
      "Sin actividad en GitLab. Marca la casilla, ajusta horas, proyecto y tarea y escribe el resumen si quieres fichar igualmente.";
    card.append(note);
  }

  for (const line of day.lines) {
    card.append(renderWeekLine(day, line));
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "button ghost small";
  addBtn.textContent = "+ Añadir tarea";
  addBtn.addEventListener("click", () => {
    const template = day.lines[day.lines.length - 1];
    day.lines.push(
      makeLine({
        opProjectId: template?.opProjectId || "",
        projectEdited: true,
        wpId: template?.wpId || "",
        wpEdited: true,
        include: true,
        extra: true
      })
    );
    repaintWeekDay(day);
    refreshPostButton();
  });
  card.append(addBtn);

  return card;
}

function repaintWeekDay(day) {
  const wrap = $("weeklyDays");
  const old = wrap.querySelector(`[data-date="${day.date}"]`);
  const fresh = renderWeekDay(day);
  if (old) {
    old.replaceWith(fresh);
  } else {
    wrap.append(fresh);
  }
  refreshPostButton();
}

function renderWeekDays() {
  $("weeklyDays").replaceChildren();
  for (const day of state.weekly.days) {
    $("weeklyDays").append(renderWeekDay(day));
  }
  refreshPostButton();
}

async function summarizeDay(day) {
  const line = day.lines[0];
  if (day.existing.length && line.skipReason) {
    return;
  }
  if (!day.hasActivity) {
    if (!line.textEdited) {
      line.text = "Sin actividad registrada en GitLab para este día.";
    }
    return;
  }
  const result = await send({
    type: "GENERATE_SUMMARY",
    date: day.date,
    projectName:
      (day.evidence?.projects || []).join(", ") ||
      day.evidence?.project?.path ||
      state.config.gitlabProject,
    evidence: day.evidence
  });
  if (!line.textEdited) {
    line.text = result.text;
  }
  if (result.warning) {
    day.warnings.push(result.warning);
  }
}

async function runGenerate(dates, evidenceList, existingData, existingError) {
  const evidenceByDate = {};
  for (const evidence of evidenceList) {
    evidenceByDate[evidence.date] = evidence;
  }
  const existingByDate = existingData?.byDate || existingData || {};

  buildDays(dates, evidenceByDate, existingByDate, existingError);

  // Precarga las tareas del proyecto inicial de cada día.
  const projectIds = [
    ...new Set(state.weekly.days.map((day) => String(day.lines[0].opProjectId)).filter(Boolean))
  ];
  for (const projectId of projectIds) {
    try {
      await loadWeekWorkPackages(projectId);
    } catch {
      // Se avisará al pintar la línea si la lista está vacía.
    }
  }

  $("weeklyTitle").textContent =
    state.mode === "weekly" ? "Resumen por día" : "Resumen del día";
  $("weeklySection").classList.remove("hidden");
  renderWeekDays();

  setStatus("Redactando resúmenes...");
  for (let index = 0; index < state.weekly.days.length; index += 1) {
    const day = state.weekly.days[index];
    $("weeklyProgress").textContent = `Día ${index + 1} de ${state.weekly.days.length}`;
    await summarizeDay(day);
    repaintWeekDay(day);
  }
  $("weeklyProgress").textContent = "";
}

async function generate() {
  if (state.busy) {
    return;
  }
  if (!secretsUsable()) {
    setStatus("Desbloquea la caja de tokens o configura los tokens en ajustes.", "error");
    $("settingsPanel").classList.remove("hidden");
    return;
  }
  if (!isConfigured(state.config || {})) {
    setStatus("Completa y guarda los ajustes antes de continuar.", "error");
    $("settingsPanel").classList.remove("hidden");
    return;
  }

  const date = $("date").value;
  if (!date) {
    setStatus("Elige un día.", "error");
    return;
  }

  state.busy = true;
  resetResult();
  resetWeekly();
  $("generateBtn").disabled = true;
  setStatus("Leyendo actividad de GitLab...");

  try {
    const [evidence, existing] = await Promise.all([
      send({ type: "FETCH_DAY", date }),
      send({ type: "CHECK_EXISTING", date })
        .then((data) => ({ byDate: { [date]: data.entries || [] } }))
        .catch((error) => ({ byDate: {}, error: error.message }))
    ]);

    await runGenerate([date], [evidence], existing.byDate, existing.error);
    setStatus("Resumen listo. Revísalo, añade tareas si quieres dividir el día y pulsa Fichar.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    $("generateBtn").disabled = false;
    refreshPostButton();
  }
}

async function generateWeek() {
  if (state.busy) {
    return;
  }
  if (!secretsUsable()) {
    setStatus("Desbloquea la caja de tokens o configura los tokens en ajustes.", "error");
    $("settingsPanel").classList.remove("hidden");
    return;
  }
  if (!isConfigured(state.config || {})) {
    setStatus("Completa y guarda los ajustes antes de continuar.", "error");
    $("settingsPanel").classList.remove("hidden");
    return;
  }

  const from = $("weekFrom").value;
  const to = $("weekTo").value;
  if (!from || !to) {
    setStatus("Elige el rango de días.", "error");
    return;
  }

  let dates;
  try {
    dates = enumerateDates(from, to);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  state.busy = true;
  resetResult();
  resetWeekly();
  $("generateBtn").disabled = true;
  setStatus("Leyendo GitLab para el rango...");

  try {
    const [evidenceList, existing] = await Promise.all([
      send({ type: "FETCH_RANGE", dates }),
      send({ type: "CHECK_EXISTING_RANGE", dates }).catch((error) => ({
        error: error.message,
        byDate: {}
      }))
    ]);

    await runGenerate(dates, evidenceList, existing.byDate, existing.error);
    setStatus("Resúmenes listos. Revisa cada día, divide tareas si quieres y pulsa Fichar.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    $("generateBtn").disabled = false;
    refreshPostButton();
  }
}

function findWeeklyLine(lineId) {
  for (const day of state.weekly.days) {
    const line = day.lines.find((item) => item.id === lineId);
    if (line) {
      return line;
    }
  }
  return null;
}

async function postEntries() {
  if (state.busy) {
    return;
  }
  if (!secretsUsable()) {
    setStatus("Desbloquea la caja de tokens o configura los tokens en ajustes.", "error");
    $("settingsPanel").classList.remove("hidden");
    return;
  }

  const targets = weeklyEligibleLines();
  if (!targets.length) {
    const anyChecked = state.weekly.days.some((day) =>
      day.lines.some((line) => line.include && !line.posted)
    );
    setStatus(
      anyChecked
        ? "Hay tareas marcadas pero incompletas: revisa tramo, proyecto y resumen."
        : "No hay tareas marcadas para fichar.",
      "error"
    );
    return;
  }

  const lines = targets.map(({ day, line }) => {
    const hours = dayHours(line);
    const tag = line.extra ? " [+ tarea]" : "";
    const existingTag = line.preExisting && line.include ? " [existente igualmente]" : "";
    return `• ${day.date} ${line.start}–${line.end}: ${formatHours(hours)} → ${weekProjectLabel(
      line.opProjectId
    )} · ${weekWorkPackageLabel(line)}${tag}${existingTag}`;
  });
  const confirmed = window.confirm(
    `¿Fichar ${targets.length} tarea(s) en OpenProject?\n\n${lines.join("\n")}`
  );
  if (!confirmed) {
    return;
  }

  state.busy = true;
  $("postBtn").disabled = true;
  setStatus("Creando fichajes en OpenProject...");

  try {
    const results = await send({
      type: "CREATE_ENTRIES",
      entries: targets.map(({ day, line }) => ({
        lineId: line.id,
        date: day.date,
        start: line.start,
        end: line.end,
        projectId: line.opProjectId,
        workPackageId: line.wpId,
        comment: line.text.trim(),
        allowExisting: Boolean(line.extra || line.preExisting)
      }))
    });

    for (const item of results.created || []) {
      const line = findWeeklyLine(item.lineId);
      if (line) {
        line.posted = true;
        line.postedId = item.id;
        line.postedHours = item.hours;
        line.skipReason = null;
        line.error = null;
      }
    }
    for (const item of results.skipped || []) {
      const line = findWeeklyLine(item.lineId);
      if (line) {
        line.skipReason = item.reason;
        line.include = false;
      }
    }
    for (const item of results.failed || []) {
      const line = findWeeklyLine(item.lineId);
      if (line) {
        line.error = item.error;
      }
    }

    for (const day of state.weekly.days) {
      repaintWeekDay(day);
    }

    const createdCount = (results.created || []).length;
    const skippedCount = (results.skipped || []).length;
    const failedCount = (results.failed || []).length;
    const parts = [`Fichados: ${createdCount}`];
    if (skippedCount) {
      parts.push(`omitidos: ${skippedCount}`);
    }
    if (failedCount) {
      parts.push(`fallidos: ${failedCount}`);
    }
    setStatus(parts.join(" · "), failedCount ? "error" : "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    refreshPostButton();
  }
}

async function post() {
  return postEntries();
}
async function testConnections() {
  setSettingsStatus("Guardando y probando conexiones...");
  try {
    await saveSettings({ silent: true });
    const result = await send({ type: "TEST_CONNECTIONS" });
    const parts = [];
    parts.push(
      result.gitlab.ok
        ? `GitLab OK: ${result.gitlab.user} / ${result.gitlab.project}`
        : `GitLab ERROR: ${result.gitlab.error}`
    );
    parts.push(
      result.openproject.ok
        ? `OpenProject OK: ${result.openproject.project} / WP ${result.openproject.workPackage} / ${
            result.openproject.activity || "actividad sin detectar"
          }`
        : `OpenProject ERROR: ${result.openproject.error}`
    );
    if (result.openproject.activityWarning) {
      parts.push(`Actividad: ${result.openproject.activityWarning}`);
    }
    parts.push(`LLM: ${result.llm.configured ? "configurado" : "sin configurar"}`);
    setSettingsStatus(parts.join(" · "), result.gitlab.ok && result.openproject.ok ? "ok" : "error");
  } catch (error) {
    setSettingsStatus(error.message, "error");
  }
}

async function detectActivity() {
  const name = $("openprojectActivityName").value.trim() || "Development";
  setSettingsStatus(`Buscando actividad «${name}»...`);
  try {
    await saveSettings({ silent: true });
    const activity = await send({ type: "DETECT_ACTIVITY", name });
    $("openprojectActivityId").value = activity.id;
    state.config = await saveConfig({
      openprojectActivityId: String(activity.id),
      openprojectActivityName: activity.title || name
    });
    const available = (activity.activities || []).map((item) => item.title).filter(Boolean);
    setSettingsStatus(
      `Actividad «${activity.title}» detectada (ID ${activity.id}).${
        available.length ? ` Disponibles: ${available.join(", ")}.` : ""
      }`,
      "ok"
    );
  } catch (error) {
    setSettingsStatus(error.message, "error");
  }
}

async function refreshSecretStatus() {
  state.secretStatus = await getSecretStatus();
  applySecretStatus(state.secretStatus);
  return state.secretStatus;
}

async function createVaultFromSettings() {
  const password = $("newVaultPassword").value;
  const confirmation = $("newVaultPassword2").value;
  if (password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres");
  }
  if (password !== confirmation) {
    throw new Error("Las contraseñas no coinciden");
  }

  let current = {};
  try {
    current = await getSecrets();
  } catch {
    current = {};
  }
  const secrets = mergeSecrets(current, readEnteredSecrets());
  if (!Object.values(secrets).some(Boolean)) {
    throw new Error("Introduce al menos un token antes de crear la caja");
  }

  await setupVault(password, secrets);
  state.config = await getConfig();
  $("newVaultPassword").value = "";
  $("newVaultPassword2").value = "";
  $("gitlabToken").value = "";
  $("openprojectToken").value = "";
  $("llmApiKey").value = "";
  await refreshSecretStatus();
  setSettingsStatus("Caja cifrada creada y desbloqueada.", "ok");
  await loadProjects();
}

async function unlockVaultWithPassword(password) {
  if (!password) {
    throw new Error("Introduce la contraseña");
  }
  await unlock(password);
  await refreshSecretStatus();
  await loadProjects();
}

async function unlockVaultFromSettings() {
  const password = $("vaultPassword").value;
  await unlockVaultWithPassword(password);
  $("vaultPassword").value = "";
  setSettingsStatus("Caja desbloqueada.", "ok");
}

async function lockVaultFromSettings() {
  await lock();
  await refreshSecretStatus();
  renderProjectOptions([], "", "Caja bloqueada");
  renderWorkPackageOptions([], "", "Selecciona un proyecto");
  setSettingsStatus("Caja bloqueada.", "ok");
}

async function useSessionFromSettings() {
  await switchToSession();
  state.config = await getConfig();
  await refreshSecretStatus();
  setSettingsStatus("Los tokens se guardarán solo en esta sesión.", "ok");
  await loadProjects();
}

async function forgetAllSecrets() {
  if (!window.confirm("¿Olvidar todos los tokens guardados? Tendrás que volver a introducirlos.")) {
    return;
  }
  await forgetSecrets();
  state.config = await getConfig();
  $("gitlabToken").value = "";
  $("openprojectToken").value = "";
  $("llmApiKey").value = "";
  await refreshSecretStatus();
  resetResult();
  resetWeekly();
  renderProjectOptions([], "", "Configura los tokens");
  renderWorkPackageOptions([], "", "Selecciona un proyecto");
  setSettingsStatus("Tokens olvidados.", "ok");
}

async function init() {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  await ensureMigrated();
  state.config = await getConfig();
  populateSettings(state.config);
  await refreshSecretStatus();

  $("date").value = todayISO();
  $("start").value = state.config.defaultStart || "08:00";
  $("end").value = state.config.defaultEnd || "15:00";
  $("weekFrom").value = defaultWeekRange().from;
  $("weekTo").value = defaultWeekRange().to;
  setMode("daily");
  syncSelectionFields();
  currentRange();
  refreshPostButton();
  if (secretsUsable()) {
    await loadProjects();
  } else {
    renderProjectOptions([], "", "Desbloquea o configura los tokens");
    renderWorkPackageOptions([], "", "Selecciona un proyecto");
  }

  $("settingsToggle").addEventListener("click", () => {
    const panel = $("settingsPanel");
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);
    $("settingsToggle").setAttribute("aria-expanded", String(opening));
  });

  $("saveSettingsBtn").addEventListener("click", async () => {
    try {
      await saveSettings();
      populateSettings(state.config);
      await loadProjects();
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  });

  $("createVaultBtn").addEventListener("click", async () => {
    try {
      await createVaultFromSettings();
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  });

  $("quickUnlockBtn").addEventListener("click", async () => {
    try {
      await unlockVaultWithPassword($("quickUnlockPassword").value);
      $("quickUnlockPassword").value = "";
      $("quickUnlockError").classList.add("hidden");
      setStatus("Caja desbloqueada.", "success");
    } catch (error) {
      $("quickUnlockError").textContent = error.message;
      $("quickUnlockError").classList.remove("hidden");
    }
  });

  $("quickUnlockPassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("quickUnlockBtn").click();
    }
  });

  $("unlockVaultBtn").addEventListener("click", async () => {
    try {
      await unlockVaultFromSettings();
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  });

  $("lockVaultBtn").addEventListener("click", async () => {
    try {
      await lockVaultFromSettings();
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  });

  $("useSessionBtn").addEventListener("click", async () => {
    try {
      await useSessionFromSettings();
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  });

  $("forgetSecretsBtn").addEventListener("click", async () => {
    try {
      await forgetAllSecrets();
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  });

  $("projectSelect").addEventListener("change", async () => {
    const projectId = $("projectSelect").value;
    state.config = await saveConfig({
      openprojectProjectId: projectId,
      openprojectWorkPackageId: ""
    });
    syncSelectionFields();
    if (state.mode === "weekly" && state.weekly.days.length) {
      // Conserva los resúmenes generados: propaga el proyecto a los días no editados
      // y precarga sus tareas.
      try {
        await loadWeekWorkPackages(projectId);
      } catch (error) {
        setStatus(error.message, "error");
      }
      propagateGlobalProject();
    } else {
      resetWeekly();
    }
    resetResult();
    setStatus("");
    await loadWorkPackages(projectId);
  });

  $("wpSearch").addEventListener("input", refreshWorkPackageOptions);

  $("wpSelect").addEventListener("change", async () => {
    const workPackageId = $("wpSelect").value;
    state.config = await saveConfig({
      openprojectProjectId: $("projectSelect").value,
      openprojectWorkPackageId: workPackageId
    });
    syncSelectionFields();
    resetResult();
    setStatus("");
    propagateGlobalWorkPackage();
  });

  $("testBtn").addEventListener("click", testConnections);
  $("detectActivityBtn").addEventListener("click", detectActivity);
  $("generateBtn").addEventListener(
    "click",
    () => (state.mode === "weekly" ? generateWeek() : generate())
  );
  $("postBtn").addEventListener("click", () => post());
  $("modeDaily").addEventListener("click", () => setMode("daily"));
  $("modeWeekly").addEventListener("click", () => setMode("weekly"));
  $("weekFrom").addEventListener("change", () => {
    resetWeekly();
    setStatus("");
  });
  $("weekTo").addEventListener("change", () => {
    resetWeekly();
    setStatus("");
  });

  $("start").addEventListener("input", () => {
    currentRange();
    refreshPostButton();
  });
  $("end").addEventListener("input", () => {
    currentRange();
    refreshPostButton();
  });
  $("start").addEventListener("change", propagateGlobalHours);
  $("end").addEventListener("change", propagateGlobalHours);

  $("date").addEventListener("change", () => {
    resetResult();
    resetWeekly();
    setStatus("");
  });

  setInterval(async () => {
    if (!state.config) {
      return;
    }
    const wasUnlocked = state.secretStatus?.unlocked;
    await refreshSecretStatus();
    if (wasUnlocked && state.secretStatus?.mode === "vault" && !state.secretStatus.unlocked) {
      setStatus("Caja de tokens bloqueada por inactividad.", "error");
    }
  }, 60000);
}

init().catch((error) => {
  setStatus(`Error al iniciar: ${error.message}`, "error");
});