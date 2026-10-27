import test from "node:test";
import assert from "node:assert/strict";
import {
  autoSelectWorkPackage,
  durationToMinutes,
  filterWorkPackages,
  loggedTimeRange,
  pairKey,
  parseLoggedEntry,
  planEntryActions,
  splitExisting
} from "../src/weekly.js";

test("durationToMinutes convierte duraciones ISO", () => {
  assert.equal(durationToMinutes("PT7H15M"), 435);
  assert.equal(durationToMinutes("PT7H"), 420);
  assert.equal(durationToMinutes("PT30M"), 30);
  assert.equal(durationToMinutes("PT0H"), null);
  assert.equal(durationToMinutes(""), null);
  assert.equal(durationToMinutes("7 horas"), null);
});

test("loggedTimeRange deriva el fin desde startTime + duración", () => {
  const range = loggedTimeRange("2026-10-26T06:00:00.000Z", "PT7H15M", "UTC");
  assert.deepEqual(range, { start: "06:00", end: "13:15" });

  const exacta = loggedTimeRange("2026-10-26T22:45:00.000Z", "PT30M", "UTC");
  assert.deepEqual(exacta, { start: "22:45", end: "23:15" });

  assert.equal(loggedTimeRange("", "PT7H", "UTC"), null);
  assert.equal(loggedTimeRange("no-es-fecha", "PT7H", "UTC"), null);

  // Sin duración conocida: solo el inicio.
  const inicio = loggedTimeRange("2026-10-26T08:00:00.000Z", "", "UTC");
  assert.deepEqual(inicio, { start: "08:00", end: "08:00" });
});

test("splitExisting separa el proyecto objetivo del resto", () => {
  const entries = [
    { id: 1, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/101" } } },
    { id: 2, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/102" } } },
    { id: 3, spentOn: "2026-10-27", _links: { project: { href: "/api/v3/projects/101" } } },
    { id: 4, spentOn: "2026-10-27", _links: { project: { href: "/api/v3/projects/103" } } }
  ];

  const split = splitExisting(entries, "101");
  assert.deepEqual(Object.keys(split.byDate), ["2026-10-26", "2026-10-27"]);
  assert.deepEqual(
    split.byDate["2026-10-26"].map((e) => e.id),
    [1]
  );
  assert.deepEqual(
    split.allByDate["2026-10-26"].map((e) => e.id),
    [1, 2]
  );
  assert.equal(split.allByDate["2026-10-27"].length, 2);
});

test("splitExisting sin proyecto objetivo lo mete todo en byDate", () => {
  const entries = [
    { id: 1, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/101" } } },
    { id: 2, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/102" } } }
  ];
  const split = splitExisting(entries, "");
  assert.equal(split.byDate["2026-10-26"].length, 2);
  assert.equal(split.allByDate["2026-10-26"].length, 2);
});

test("parseLoggedEntry incluye startTime", () => {
  const parsed = parseLoggedEntry({
    id: 902,
    spentOn: "2026-10-26",
    startTime: "2026-10-26T06:00:00.000Z",
    hours: "PT7H15M",
    _links: { project: { href: "/api/v3/projects/101" } }
  });
  assert.equal(parsed.startTime, "2026-10-26T06:00:00.000Z");
});

test("parseLoggedEntry extrae proyecto, tarea, horas y resumen de un entry HAL", () => {
  const entry = {
    id: 900,
    spentOn: "2026-10-26",
    hours: "PT7H15M",
    comment: { raw: "  Desarrollo de la cabecera  " },
    _links: {
      project: { href: "/api/v3/projects/101" },
      entity: { href: "/api/v3/work_packages/202" }
    }
  };
  const parsed = parseLoggedEntry(entry);
  assert.equal(parsed.id, 900);
  assert.equal(parsed.date, "2026-10-26");
  assert.equal(parsed.projectId, "101");
  assert.equal(parsed.workPackageId, "202");
  assert.equal(parsed.hours, "PT7H15M");
  assert.equal(parsed.comment, "  Desarrollo de la cabecera  ");
});

test("parseLoggedEntry tolera entries sin comentario ni entidad", () => {
  const parsed = parseLoggedEntry({
    id: 901,
    spentOn: "2026-10-27",
    hours: "PT2H",
    _links: { project: { href: "/api/v3/projects/101" } }
  });
  assert.equal(parsed.workPackageId, "");
  assert.equal(parsed.comment, "");
  assert.equal(parsed.projectId, "101");
});

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
