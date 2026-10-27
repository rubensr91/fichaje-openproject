import test from "node:test";
import assert from "node:assert/strict";
import { fetchRange } from "../src/gitlab.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const baseConfig = {
  gitlabBaseUrl: "https://gitlab.example.test",
  gitlabProject: "demo/web",
  gitlabToken: "test-token",
  gitlabAuthor: "ruben"
};

test("fetchRange pide usuario y proyecto una vez y la actividad por día", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);

    if (target.includes("/api/v4/user")) {
      return jsonResponse({ id: 7, username: "ruben", name: "Rubén", email: "ruben@ejemplo.es" });
    }
    if (target.includes("/repository/commits")) {
      const since = new URL(target).searchParams.get("since");
      return jsonResponse(
        [{ title: `commit ${since}`, author_name: "ruben", author_email: "ruben@ejemplo.es" }]
      );
    }
    if (target.includes("/merge_requests") || target.includes("/issues")) {
      return jsonResponse([]);
    }
    if (/\/api\/v4\/projects\/demo%2Fweb$/.test(target)) {
      return jsonResponse({ id: 42, name: "web", path_with_namespace: "demo/web" });
    }
    throw new Error(`Petición inesperada: ${target}`);
  };

  try {
    const days = await fetchRange(baseConfig, ["2026-10-26", "2026-10-30"]);

    assert.equal(days.length, 2);
    assert.equal(days[0].date, "2026-10-26");
    assert.equal(days[1].date, "2026-10-30");
    assert.equal(days[0].counts.commits, 1);
    assert.match(days[0].commits[0].title, /2026-10-2[56]/);

    const userCalls = calls.filter((url) => url.includes("/api/v4/user")).length;
    const projectCalls = calls.filter((url) =>
      /\/api\/v4\/projects\/demo%2Fweb$/.test(url)
    ).length;
    assert.equal(userCalls, 1);
    assert.equal(projectCalls, 1);

    const commitCalls = calls.filter((url) => url.includes("/repository/commits"));
    assert.equal(commitCalls.length, 2);
    const sincings = commitCalls.map((url) => new URL(url).searchParams.get("since"));
    assert.equal(new Set(sincings).size, 2);
    for (const since of sincings) {
      assert.match(since, /^2026-10-(2[5-9]|3[01])T/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRange rechaza un rango vacío", async () => {
  await assert.rejects(fetchRange(baseConfig, []), /vacío/);
});
