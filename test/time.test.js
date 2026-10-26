import test from "node:test";
import assert from "node:assert/strict";
import {
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