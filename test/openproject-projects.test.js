import test from "node:test";
import assert from "node:assert/strict";
import { getAvailableProjects, getProjectWorkPackages } from "../src/openproject.js";

const config = {
  openprojectBaseUrl: "https://projects.example.test",
  openprojectToken: "test-token",
  openprojectProjectId: "101",
  openprojectWorkPackageId: "201"
};

function collection(elements, total = elements.length) {
  return {
    _type: "Collection",
    total,
    count: elements.length,
    _embedded: { elements }
  };
}

test("lista los proyectos disponibles para fichar", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/time_entries\/available_projects/);
    return new Response(
      JSON.stringify(
        collection([
          { id: 101, name: "Demo Project", identifier: "demo", active: true },
          { id: 102, name: "Other Project", identifier: "other", active: true }
        ])
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const projects = await getAvailableProjects(config);
    assert.deepEqual(
      projects.map((project) => project.id),
      ["101", "102"]
    );
    assert.equal(projects[0].name, "Demo Project");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lista work packages y filtra los que permiten fichar", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/projects\/101\/work_packages/);
    return new Response(
      JSON.stringify(
        collection([
          {
            id: 201,
            displayId: 201,
            subject: "Tarea de ejemplo",
            _links: {
              logTime: { href: "/api/v3/time_entries" },
              status: { title: "In progress" }
            }
          },
          {
            id: 202,
            subject: "Sin permiso",
            _links: { status: { title: "New" } }
          }
        ])
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const workPackages = await getProjectWorkPackages(config, "101");
    assert.equal(workPackages.length, 1);
    assert.equal(workPackages[0].id, "201");
    assert.equal(workPackages[0].code, "201");
    assert.equal(workPackages[0].subject, "Tarea de ejemplo");
    assert.equal(workPackages[0].canLogTime, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});