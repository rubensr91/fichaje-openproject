import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceText,
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
  assert.match(messages[0].content, /agrupa el resumen por proyecto/);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /2026-10-26/);
  assert.match(messages[1].content, /demo\/project/);
});

test("el texto de evidencia marca el proyecto en cada item cuando existe", () => {
  const text = buildEvidenceText(
    {
      commits: [
        { title: "feat: login", message: "feat: login", project: "grupo/web" },
        { title: "feat: endpoint", message: "", project: "grupo/api" }
      ],
      mergeRequests: [{ iid: 5, title: "Notificaciones", state: "merged", project: "grupo/web" }],
      issues: []
    },
    "2026-10-26",
    "grupo/web, grupo/api"
  );
  assert.match(text, /Fecha: 2026-10-26/);
  assert.match(text, /Proyecto: grupo\/web, grupo\/api/);
  assert.match(text, /- \[grupo\/web\] feat: login/);
  assert.match(text, /- \[grupo\/api\] feat: endpoint/);
  assert.match(text, /- \[grupo\/web\] !5 Notificaciones \[merged\]/);
  assert.ok(!text.includes("Todas las contribuciones"));
});

test("el resumen local agrupa por proyecto los títulos marcados", () => {
  const multi = {
    commits: [
      { title: "[grupo/web] feat: login", message: "" },
      { title: "[grupo/web] fix: rutas", message: "" },
      { title: "[grupo/api] feat: endpoint", message: "" },
      { title: "tarea sin prefijo", message: "" }
    ]
  };
  const text = fallbackSummary(multi, "Todas las contribuciones");

  assert.match(text, /\*\*grupo\/web\*\*/);
  assert.match(text, /\*\*grupo\/api\*\*/);
  assert.match(text, /\*\*Todas las contribuciones\*\*/);
  const webIndex = text.indexOf("**grupo/web**");
  const apiIndex = text.indexOf("**grupo/api**");
  const generalIndex = text.indexOf("**Todas las contribuciones**");
  assert.ok(webIndex < apiIndex && apiIndex < generalIndex);
  assert.ok(text.includes("• feat: login"));
  assert.ok(text.includes("• feat: endpoint"));
  assert.ok(!text.includes("[grupo/web] feat: login"));
});

test("el resumen local sin prefijos mantiene el formato de un solo proyecto", () => {
  const text = fallbackSummary(evidence, "demo/project");
  assert.match(text, /^demo\/project: /);
  assert.ok(!text.includes("**"));
});