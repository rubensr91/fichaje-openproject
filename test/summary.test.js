import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLlmMessages,
  fallbackSummary,
  normalizeEvidence
} from "../src/summary.js";

const evidence = {
  commits: [
    { title: "feat: cabecera de cliente", message: "feat: cabecera de cliente" },
    { title: "fix: filtros", message: "fix: filtros" }
  ],
  mergeRequests: [{ iid: 53, title: "Notificaciones", description: "Toast e historial", state: "merged" }],
  issues: [{ iid: 12, title: "Ajustar tabla", description: "", state: "opened" }]
};

test("el resumen local incluye commits, MRs e issues sin duplicados", () => {
  const text = fallbackSummary(evidence, "demo/project");
  assert.match(text, /demo\/project/);
  assert.match(text, /cabecera de cliente/);
  assert.match(text, /!53 Notificaciones/);
  assert.match(text, /#12 Ajustar tabla/);
  assert.equal(text.match(/cabecera de cliente/g).length, 1);
});

test("el resumen local funciona sin actividad", () => {
  assert.match(fallbackSummary({}), /Sin actividad/);
});

test("normaliza y recorta campos", () => {
  const normalized = normalizeEvidence({
    commits: [{ title: "x".repeat(300), message: "m".repeat(500) }]
  });
  assert.ok(normalized.commits[0].title.length <= 180);
  assert.ok(normalized.commits[0].message.length <= 400);
});

test("construye mensajes para el LLM con fecha y proyecto", () => {
  const messages = buildLlmMessages(evidence, "2026-10-26", "demo/project");
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /No inventes/);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /2026-10-26/);
  assert.match(messages[1].content, /demo\/project/);
});