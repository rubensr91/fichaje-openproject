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
import { formatHours, rangeHours, todayISO } from "./src/time.js";

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  secretStatus: null,
  evidence: null,
  existing: [],
  projects: [],
  workPackages: [],
  posted: false,
  busy: false
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

function refreshPostButton() {
  const hasSummary = Boolean($("summary").value.trim());
  $("postBtn").disabled =
    state.busy ||
    state.posted ||
    !hasSummary ||
    state.existing.length > 0 ||
    !isConfigured(state.config || {}) ||
    !secretsUsable();
}

function resetResult() {
  state.evidence = null;
  state.existing = [];
  state.posted = false;
  $("postBtn").textContent = "Fichar";
  $("summary").value = "";
  $("summarySection").classList.add("hidden");
  $("existingBox").classList.add("hidden");
  $("existingBox").replaceChildren();
  $("summarySource").classList.add("hidden");
  $("summaryWarning").classList.add("hidden");
  refreshPostButton();
}

function populateSettings(config) {
  $("gitlabBaseUrl").value = config.gitlabBaseUrl;
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

function renderExisting(entries) {
  state.existing = entries;
  const box = $("existingBox");
  box.replaceChildren();

  if (!entries.length) {
    box.classList.add("hidden");
    refreshPostButton();
    return;
  }

  const title = document.createElement("strong");
  title.textContent = "Ya hay fichaje para este día y proyecto.";
  box.append(title);

  const list = document.createElement("ul");
  for (const entry of entries) {
    const item = document.createElement("li");
    const hours = entry.hours || "";
    const comment = entry.comment?.raw || "";
    item.textContent = `${hours}${comment ? ` — ${comment}` : ""} (ID ${entry.id})`;
    list.append(item);
  }
  list.className = "existing-list";
  box.append(list);
  box.classList.remove("hidden");
  refreshPostButton();
}

function renderSummary(result, day) {
  $("summary").value = result.text;
  $("summarySection").classList.remove("hidden");
  $("summarySource").textContent = result.source === "llm" ? "LLM" : "Local";
  $("summarySource").classList.remove("hidden");

  const counts = day.counts || {};
  $("evidenceHint").textContent = `${counts.commits || 0} commits · ${
    counts.mergeRequests || 0
  } MRs · ${counts.issues || 0} issues`;

  const warnings = [day.warning, result.warning].filter(Boolean);
  if (warnings.length) {
    $("summaryWarning").textContent = warnings.join(" ");
    $("summaryWarning").classList.remove("hidden");
  } else {
    $("summaryWarning").classList.add("hidden");
  }
  refreshPostButton();
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

  const hours = currentRange();
  if (hours === null) {
    setStatus("Revisa el tramo horario.", "error");
    return;
  }

  const date = $("date").value;
  if (!date) {
    setStatus("Elige un día.", "error");
    return;
  }

  state.busy = true;
  resetResult();
  $("generateBtn").disabled = true;
  setStatus("Leyendo actividad de GitLab...");

  try {
    const [day, existing] = await Promise.all([
      send({ type: "FETCH_DAY", date }),
      send({ type: "CHECK_EXISTING", date }).catch((error) => ({
        error: error.message
      }))
    ]);

    state.evidence = day;
    setStatus("Redactando resumen...");

    const result = await send({
      type: "GENERATE_SUMMARY",
      date,
      projectName: day.project?.path || state.config.gitlabProject,
      evidence: day
    });

    renderSummary(result, day);
    if (existing?.error) {
      setStatus(`Aviso: no se pudo comprobar si ya existe un fichaje (${existing.error}).`, "error");
    } else {
      renderExisting(existing?.entries || []);
      setStatus("Resumen listo. Revísalo y pulsa Fichar.");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    $("generateBtn").disabled = false;
    refreshPostButton();
  }
}

async function post() {
  if (state.busy) {
    return;
  }
  if (!secretsUsable()) {
    setStatus("Desbloquea la caja de tokens o configura los tokens en ajustes.", "error");
    $("settingsPanel").classList.remove("hidden");
    return;
  }
  const date = $("date").value;
  const start = $("start").value;
  const end = $("end").value;
  const comment = $("summary").value.trim();
  const hours = currentRange();

  if (!comment) {
    setStatus("El resumen está vacío.", "error");
    return;
  }
  if (hours === null) {
    setStatus("Revisa el tramo horario.", "error");
    return;
  }

  const confirmed = window.confirm(
    `¿Fichar ${formatHours(hours)} el ${date} (${start}–${end}) en OpenProject?`
  );
  if (!confirmed) {
    return;
  }

  state.busy = true;
  $("postBtn").disabled = true;
  setStatus("Comprobando fichajes existentes...");

  try {
    const existing = await send({ type: "CHECK_EXISTING", date });
    if (existing.entries?.length) {
      renderExisting(existing.entries);
      throw new Error("Ya existe un fichaje para ese día. No se ha creado otro.");
    }

    setStatus("Creando fichaje en OpenProject...");
    const entry = await send({
      type: "CREATE_ENTRY",
      date,
      start,
      end,
      comment
    });

    state.posted = true;
    setStatus(`Fichaje creado correctamente (ID ${entry.id}).`, "success");
    $("postBtn").disabled = true;
    $("postBtn").textContent = "Fichado";
  } catch (error) {
    setStatus(error.message, "error");
    $("postBtn").textContent = "Fichar";
  } finally {
    state.busy = false;
    refreshPostButton();
  }
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

async function unlockVaultFromSettings() {
  const password = $("vaultPassword").value;
  if (!password) {
    throw new Error("Introduce la contraseña");
  }
  await unlock(password);
  $("vaultPassword").value = "";
  await refreshSecretStatus();
  setSettingsStatus("Caja desbloqueada.", "ok");
  await loadProjects();
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
  });

  $("testBtn").addEventListener("click", testConnections);
  $("detectActivityBtn").addEventListener("click", detectActivity);
  $("generateBtn").addEventListener("click", generate);
  $("postBtn").addEventListener("click", post);

  $("start").addEventListener("input", () => {
    currentRange();
    refreshPostButton();
  });
  $("end").addEventListener("input", () => {
    currentRange();
    refreshPostButton();
  });
  $("summary").addEventListener("input", refreshPostButton);

  $("date").addEventListener("change", () => {
    resetResult();
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