import test from "node:test";
import assert from "node:assert/strict";
import { redactText } from "../src/redact.js";

const secrets = [
  ["glpat", "a".repeat(30)].join("-"),
  ["opapi", "0".repeat(64)].join("-"),
  ["AIza", "a".repeat(35)].join(""),
  ["sk", "a".repeat(30)].join("-"),
  "password=super-secreto-123",
  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"
];

test("redacta tokens, claves y contraseñas conocidos", () => {
  const result = redactText(`Contexto\n${secrets.join("\n")}\nFin`);
  for (const secret of secrets) {
    assert.equal(result.text.includes(secret), false, `no debe quedar: ${secret}`);
  }
  assert.ok(result.count >= secrets.length);
  assert.ok(result.text.includes("[REDACTED:"));
});

test("no redacta texto normal", () => {
  const result = redactText("fix: ajustar cabecera de la tabla de clientes");
  assert.equal(result.count, 0);
  assert.equal(result.text, "fix: ajustar cabecera de la tabla de clientes");
});