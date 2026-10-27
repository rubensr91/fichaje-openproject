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
  let capturedFilters = null;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/users/me")) {
      return jsonResponse({ _type: "User", id: 28, name: "Rubén" });
    }
    if (target.includes("/time_entries")) {
      const params = new URL(target).searchParams;
      capturedFilters = JSON.parse(params.get("filters"));
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

    const spentOnFilter = capturedFilters.find((filter) => filter.spent_on).spent_on;
    assert.equal(spentOnFilter.operator, "=d");
    assert.deepEqual(spentOnFilter.values, dates);

    const userFilter = capturedFilters.find((filter) => filter.user_id).user_id;
    assert.deepEqual(userFilter.values, ["28"]);

    // Solo los del proyecto configurado: 26 y 30.
    assert.deepEqual(
      entries.map((entry) => entry.id),
      [1, 3]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rechaza una lista de fechas vacía", async () => {
  await assert.rejects(getExistingEntriesForDates(config, [], { id: 28 }), /fechas/);
});
