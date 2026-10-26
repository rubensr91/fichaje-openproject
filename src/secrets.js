import { CONFIG_KEY, getConfig, saveConfig } from "./config.js";
import {
  createVault,
  decryptWithKey,
  encryptWithKey,
  unlockVault
} from "./vault.js";

const VAULT_KEY = "fichajeVault";
const SESSION_SECRETS_KEY = "fichajeSessionSecrets";
const SESSION_VAULT_KEY = "fichajeVaultKey";
const VAULT_TTL_MS = 15 * 60 * 1000;

export const SECRET_FIELDS = ["gitlabToken", "openprojectToken", "llmApiKey"];

export class VaultLockedError extends Error {
  constructor() {
    super("La caja de tokens está bloqueada. Desbloquéala en ajustes.");
    this.code = "VAULT_LOCKED";
  }
}

async function readSessionSecrets() {
  const stored = await chrome.storage.session.get(SESSION_SECRETS_KEY);
  return stored[SESSION_SECRETS_KEY] || {};
}

async function writeSessionSecrets(secrets) {
  await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: secrets });
}

async function readVault() {
  const stored = await chrome.storage.local.get(VAULT_KEY);
  return stored[VAULT_KEY] || null;
}

async function writeVault(vault) {
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
}

async function getSessionKey() {
  const stored = await chrome.storage.session.get(SESSION_VAULT_KEY);
  const record = stored[SESSION_VAULT_KEY];
  if (!record?.key) {
    return null;
  }
  if (Date.now() - Number(record.unlockedAt || 0) > VAULT_TTL_MS) {
    await chrome.storage.session.remove(SESSION_VAULT_KEY);
    return null;
  }
  return record.key;
}

async function setSessionKey(key) {
  await chrome.storage.session.set({
    [SESSION_VAULT_KEY]: { key, unlockedAt: Date.now() }
  });
}

async function clearSessionKey() {
  await chrome.storage.session.remove(SESSION_VAULT_KEY);
}

export async function ensureMigrated() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY];
  if (!config) {
    return;
  }

  const legacy = {};
  let found = false;
  for (const field of SECRET_FIELDS) {
    if (config[field]) {
      legacy[field] = config[field];
      delete config[field];
      found = true;
    }
  }

  if (!found) {
    return;
  }

  const current = await readSessionSecrets();
  await writeSessionSecrets({ ...current, ...legacy });
  if (!config.secretMode) {
    config.secretMode = "session";
  }
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function getSecretStatus() {
  await ensureMigrated();
  const config = await getConfig();
  const vault = await readVault();
  const key = await getSessionKey();
  const session = await readSessionSecrets();

  return {
    mode: config.secretMode || "session",
    vaultExists: Boolean(vault),
    unlocked: Boolean(key),
    hasSecrets: Boolean(
      vault || SECRET_FIELDS.some((field) => Boolean(session[field]))
    )
  };
}

export async function getSecrets() {
  await ensureMigrated();
  const config = await getConfig();

  if ((config.secretMode || "session") === "vault") {
    const vault = await readVault();
    if (!vault) {
      return {};
    }
    const key = await getSessionKey();
    if (!key) {
      throw new VaultLockedError();
    }
    return decryptWithKey(key, vault);
  }

  return readSessionSecrets();
}

export async function getRuntimeConfig() {
  await ensureMigrated();
  const config = await getConfig();
  const secrets = await getSecrets();
  return { ...config, ...secrets };
}

export async function saveSecrets(patch) {
  await ensureMigrated();
  const config = await getConfig();

  if ((config.secretMode || "session") === "vault") {
    const vault = await readVault();
    const key = await getSessionKey();
    if (!vault) {
      throw new Error("No hay una caja cifrada configurada");
    }
    if (!key) {
      throw new VaultLockedError();
    }
    const current = await decryptWithKey(key, vault);
    const next = { ...current, ...patch };
    const encrypted = await encryptWithKey(key, next);
    await writeVault({ ...vault, ...encrypted });
    return next;
  }

  const current = await readSessionSecrets();
  const next = { ...current, ...patch };
  await writeSessionSecrets(next);
  return next;
}

export async function setupVault(passphrase, secrets) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres");
  }

  const { vault, keyRaw } = await createVault(passphrase, secrets);
  await writeVault(vault);
  await setSessionKey(keyRaw);
  await chrome.storage.session.remove(SESSION_SECRETS_KEY);
  await saveConfig({ secretMode: "vault" });
}

export async function unlock(passphrase) {
  const vault = await readVault();
  if (!vault) {
    throw new Error("No hay una caja cifrada configurada");
  }
  const result = await unlockVault(vault, passphrase);
  await setSessionKey(result.keyRaw);
  return result.secrets;
}

export async function lock() {
  await clearSessionKey();
}

export async function switchToSession() {
  const secrets = await getSecrets();
  await writeSessionSecrets(secrets);
  await chrome.storage.local.remove(VAULT_KEY);
  await clearSessionKey();
  await saveConfig({ secretMode: "session" });
}

export async function forgetSecrets() {
  await chrome.storage.local.remove(VAULT_KEY);
  await chrome.storage.session.remove(SESSION_SECRETS_KEY);
  await clearSessionKey();
  await saveConfig({ secretMode: "session" });
}

export function mergeSecrets(current, entered) {
  const next = { ...(current || {}) };
  for (const field of SECRET_FIELDS) {
    if (entered?.[field]) {
      next[field] = entered[field];
    }
  }
  return next;
}