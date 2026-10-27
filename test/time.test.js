import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultWeekRange,
  enumerateDates,
  formatDurationISO,
  formatHours,
  hoursToDuration,
  localDateRangeToUTC,
  rangeHours,
  todayISO
} from "../src/time.js";

test("calcula el tramo por defecto 08:00-15:15", () => {
  assert.equal(rangeHours("08:00", "15:15"), 7.25);
});

test("convierte horas a duración ISO 8601", () => {
  assert.equal(hoursToDuration(7.25), "PT7H15M");
  assert.equal(hoursToDuration(7), "PT7H");
  assert.equal(hoursToDuration(0.5), "PT30M");
});

test("rechaza tramos vacíos o invertidos", () => {
  assert.throws(() => rangeHours("15:15", "08:00"), /posterior/);
  assert.throws(() => rangeHours("08:00", "08:00"), /posterior/);
});

test("formatea horas en español", () => {
  assert.equal(formatHours(7.25), "7,25 h");
  assert.equal(formatHours(7), "7 h");
});

test("convierte un día local a rango UTC", () => {
  const range = localDateRangeToUTC("2026-06-15");
  const diff = new Date(range.before) - new Date(range.after);
  assert.ok(diff >= 23 * 60 * 60 * 1000);
  assert.ok(diff <= 25 * 60 * 60 * 1000);
});

test("todayISO devuelve una fecha ISO local", () => {
  assert.match(todayISO(new Date(2026, 0, 2)), /^2026-01-02$/);
});

test("enumera fechas del rango de forma inclusiva", () => {
  assert.deepEqual(enumerateDates("2026-10-26", "2026-10-30"), [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30"
  ]);
  assert.deepEqual(enumerateDates("2026-10-31", "2026-10-31"), ["2026-10-31"]);
});

test("rechaza rangos invertidos o fuera de límite", () => {
  assert.throws(() => enumerateDates("2026-10-30", "2026-10-26"), /posterior/);
  assert.throws(() => enumerateDates("2026-01-01", "2026-12-31"), /31 días/);
  assert.throws(() => enumerateDates("26-10-2026", "26-10-2026"), /Fecha no válida/);
});

test("el rango semanal por defecto va de lunes a viernes", () => {
  // 2026-10-27 es martes: lunes 26 y viernes 30.
  const range = defaultWeekRange(new Date(2026, 9, 27));
  assert.equal(range.from, "2026-10-26");
  assert.equal(range.to, "2026-10-30");

  const weekend = defaultWeekRange(new Date(2026, 9, 24)); // sábado
  assert.equal(weekend.from, "2026-10-19");
  assert.equal(weekend.to, "2026-10-23");
});

test("formatea duraciones ISO de OpenProject", () => {
  assert.equal(formatDurationISO("PT7H15M"), "7 h 15 min");
  assert.equal(formatDurationISO("PT7H"), "7 h");
  assert.equal(formatDurationISO("PT30M"), "30 min");
  assert.equal(formatDurationISO("PT0H"), "0 min");
  assert.equal(formatDurationISO(""), "");
});