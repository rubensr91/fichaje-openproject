import test from "node:test";
import assert from "node:assert/strict";
import { getExistingEntriesForDates } from "../src/openproject.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const config = {
  openprojectBaseUrl: "https://projects.example.test",
  openprojectToken: "test-token",
  openprojectProjectId: "101"
};

test("comprueba fichajes existentes para varias fechas y filtra por proyecto", async () => {
  const originalFetch = globalThis.fetch;
  const capturedFilters = [];

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/users/me")) {
      return jsonResponse({ _type: "User", id: 28, name: "Rubén" });
    }
    if (target.includes("/time_entries")) {
      const params = new URL(target).searchParams;
      capturedFilters.push(JSON.parse(params.get("filters")));
      return jsonResponse({
        _embedded: {
          elements: [
            {
              id: 1,
              spentOn: "2026-10-26",
              hours: "PT7H15M",
              _links: {
                project: { href: "/api/v3/projects/101" }
              }
            },
            {
              id: 2,
              spentOn: "2026-10-27",
              hours: "PT7H15M",
              _links: {
                project: { href: "/api/v3/projects/999" }
              }
            },
            {
              id: 3,
              spentOn: "2026-10-30",
              hours: "PT5H",
              _links: {
                project: { href: "/api/v3/projects/101" }
              }
            }
          ]
        }
      });
    }
    throw new Error(`Petición inesperada: ${target}`);
  };

  try {
    const dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
    const entries = await getExistingEntriesForDates(config, dates, { id: 28 });

    // Una petición por día, con =d mono-valor.
    assert.equal(capturedFilters.length, 5);
    assert.deepEqual(
      capturedFilters.map((filters) => filters.find((f) => f.spent_on).spent_on.values),
      dates.map((date) => [date])
    );
    for (const filters of capturedFilters) {
      assert.equal(filters.find((f) => f.spent_on).spent_on.operator, "=d");
      assert.deepEqual(filters.find((f) => f.user_id).user_id.values, ["28"]);
    }

    // Solo los del proyecto configurado, sin duplicar por ids.
    assert.deepEqual(
      entries.map((entry) => entry.id).sort((a, b) => a - b),
      [1, 3]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("solo cuentan las fechas pedidas aunque la API traiga otras", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return jsonResponse({
      total: 4,
      _embedded: {
        elements: [
          { id: 1, spentOn: "2026-10-25", _links: { project: { href: "/api/v3/projects/101" } } },
          { id: 2, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/101" } } },
          { id: 3, spentOn: "2026-10-28", _links: { project: { href: "/api/v3/projects/101" } } },
          { id: 4, spentOn: "2026-10-30", _links: { project: { href: "/api/v3/projects/101" } } }
        ]
      }
    });
  };

  try {
    const entries = await getExistingEntriesForDates(
      config,
      ["2026-10-26", "2026-10-30"],
      { id: 28 }
    );
    assert.deepEqual(
      entries.map((entry) => entry.id).sort((a, b) => a - b),
      [2, 4]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pagina hasta 3 páginas por día", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const params = new URL(String(url)).searchParams;
    const offset = Number(params.get("offset") || 1);
    const is26 = params.get("filters").includes("2026-10-26");
    const spentOn = is26 ? "2026-10-26" : "2026-10-27";
    const base = is26 ? 0 : 200;
    calls.push(`${spentOn}@${offset}`);
    if (offset === 1) {
      return jsonResponse({
        total: 150,
        _embedded: {
          elements: Array.from({ length: 100 }, (_unused, index) => ({
            id: base + index + 1,
            spentOn,
            _links: { project: { href: "/api/v3/projects/101" } }
          }))
        }
      });
    }
    return jsonResponse({
      total: 150,
      _embedded: {
        elements: Array.from({ length: 50 }, (_unused, index) => ({
          id: base + 101 + index,
          spentOn,
          _links: { project: { href: "/api/v3/projects/101" } }
        }))
      }
    });
  };

  try {
    const entries = await getExistingEntriesForDates(
      config,
      ["2026-10-26", "2026-10-27"],
      { id: 28 }
    );
    assert.equal(entries.length, 300);
    assert.deepEqual(calls, [
      "2026-10-26@1",
      "2026-10-26@2",
      "2026-10-27@1",
      "2026-10-27@2"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("filtra por el proyecto indicado aunque la config tenga otro", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/time_entries")) {
      return jsonResponse({
        _embedded: {
          elements: [
            { id: 1, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/101" } } },
            { id: 2, spentOn: "2026-10-26", _links: { project: { href: "/api/v3/projects/102" } } },
            { id: 3, spentOn: "2026-10-27", _links: { project: { href: "/api/v3/projects/102" } } }
          ]
        }
      });
    }
    throw new Error(`Petición inesperada: ${target}`);
  };

  try {
    const entries = await getExistingEntriesForDates(
      config,
      ["2026-10-26", "2026-10-27"],
      { id: 28 },
      "102"
    );
    assert.deepEqual(
      entries.map((entry) => entry.id),
      [2, 3]
    );

    // Sin override, sigue filtrando por el proyecto de la config (101).
    const fallback = await getExistingEntriesForDates(config, ["2026-10-26"], { id: 28 });
    assert.deepEqual(
      fallback.map((entry) => entry.id),
      [1]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rechaza una lista de fechas vacía", async () => {
  await assert.rejects(getExistingEntriesForDates(config, [], { id: 28 }), /fechas/);
});
