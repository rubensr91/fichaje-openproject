import test from "node:test";
import assert from "node:assert/strict";
import {
  createVault,
  decryptWithKey,
  encryptWithKey,
  unlockVault
} from "../src/vault.js";

const secrets = {
  gitlabToken: "glpat-test",
  openprojectToken: "opapi-test",
  llmApiKey: "sk-test"
};

test("cifra y descifra la caja con la contraseña correcta", async () => {
  const { vault, keyRaw } = await createVault("contraseña-segura", secrets);
  const unlocked = await unlockVault(vault, "contraseña-segura");
  assert.deepEqual(unlocked.secrets, secrets);
  assert.ok(unlocked.keyRaw);
  assert.ok(keyRaw);
});

test("rechaza una contraseña incorrecta", async () => {
  const { vault } = await createVault("contraseña-segura", secrets);
  await assert.rejects(() => unlockVault(vault, "otra-contraseña"), /incorrecta|dañada/);
});

test("permite actualizar secretos con la clave de sesión", async () => {
  const { vault, keyRaw } = await createVault("contraseña-segura", secrets);
  const updated = await encryptWithKey(keyRaw, {
    ...secrets,
    llmApiKey: "nueva-key"
  });
  const decrypted = await decryptWithKey(keyRaw, { ...vault, ...updated });
  assert.equal(decrypted.llmApiKey, "nueva-key");
  assert.equal(decrypted.gitlabToken, "glpat-test");
});