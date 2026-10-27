import test from "node:test";
import assert from "node:assert/strict";
import {
  autoSelectWorkPackage,
  filterWorkPackages,
  pairKey,
  planEntryActions
} from "../src/weekly.js";

const packages = [
  { id: "501", code: "1234", subject: "Login de clientes", status: "In progress", type: "Task" },
  { id: "502", code: "1235", subject: "Bug en cabecera", status: "Closed", type: "Bug" },
  { id: "503", code: "1236", subject: "Notificaciones", status: "New", type: "Feature" }
];

test("filtra tareas por código, asunto, estado o tipo", () => {
  assert.deepEqual(
    filterWorkPackages(packages, "1235").map((item) => item.id),
    ["502"]
  );
  assert.deepEqual(
    filterWorkPackages(packages, "#1235").map((item) => item.id),
    ["502"]
  );
  assert.deepEqual(
    filterWorkPackages(packages, "notif").map((item) => item.id),
    ["503"]
  );
  assert.deepEqual(
    filterWorkPackages(packages, "closed").map((item) => item.id),
    ["502"]
  );
  assert.deepEqual(
    filterWorkPackages(packages, "bug").map((item) => item.id),
    ["502"]
  );
  assert.equal(filterWorkPackages(packages, "").length, 3);
});

test("autoselecciona la tarea solo con coincidencia exacta de código o asunto", () => {
  assert.equal(autoSelectWorkPackage(packages, "1235")?.id, "502");
  assert.equal(autoSelectWorkPackage(packages, "#1235")?.id, "502");
  assert.equal(autoSelectWorkPackage(packages, "Notificaciones")?.id, "503");
  assert.equal(autoSelectWorkPackage(packages, "notificaciones")?.id, "503");
  // Parciales: no autoselecciona.
  assert.equal(autoSelectWorkPackage(packages, "notif"), null);
  assert.equal(autoSelectWorkPackage(packages, "123"), null);
  assert.equal(autoSelectWorkPackage(packages, ""), null);
});

const existing = new Map([
  [pairKey("2026-10-26", "101"), [501]],
  [pairKey("2026-10-27", "101"), [502, 503]]
]);

test("consume los fichajes existentes del par (día, proyecto)", () => {
  const plan = planEntryActions(
    [
      { lineId: "a", date: "2026-10-26", projectId: "101" },
      { lineId: "b", date: "2026-10-26", projectId: "102" }
    ],
    existing
  );

  assert.deepEqual(
    plan.toCreate.map((item) => item.lineId),
    ["b"]
  );
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].lineId, "a");
  assert.match(plan.skipped[0].reason, /501/);
});

test("las líneas extra (allowExisting) se crean aunque exista un fichaje previo", () => {
  const plan = planEntryActions(
    [
      { lineId: "a", date: "2026-10-26", projectId: "101", allowExisting: true },
      { lineId: "b", date: "2026-10-26", projectId: "101", allowExisting: true }
    ],
    existing
  );

  assert.deepEqual(
    plan.toCreate.map((item) => item.lineId),
    ["a", "b"]
  );
  assert.equal(plan.skipped.length, 0);
});

test("con dos fichajes previos se consumen las dos primeras líneas no-extra", () => {
  const plan = planEntryActions(
    [
      { lineId: "a", date: "2026-10-27", projectId: "101" },
      { lineId: "b", date: "2026-10-27", projectId: "101" },
      { lineId: "c", date: "2026-10-27", projectId: "101", allowExisting: true }
    ],
    existing
  );

  assert.deepEqual(
    plan.skipped.map((item) => item.lineId),
    ["a", "b"]
  );
  assert.deepEqual(
    plan.toCreate.map((item) => item.lineId),
    ["c"]
  );
});

test("si no hay existentes, todo se crea", () => {
  const plan = planEntryActions(
    [
      { lineId: "a", date: "2026-10-28", projectId: "101" },
      { lineId: "b", date: "2026-10-29", projectId: "101" }
    ],
    existing
  );

  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(
    plan.toCreate.map((item) => item.lineId),
    ["a", "b"]
  );
});
