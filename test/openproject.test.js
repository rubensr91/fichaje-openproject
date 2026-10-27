import test from "node:test";
import assert from "node:assert/strict";
import { createTimeEntry } from "../src/openproject.js";
import { localDateTimeToUTC } from "../src/time.js";

test("usa el work package concreto cuando se indica por entrada", async () => {
  const originalFetch = globalThis.fetch;
  let createPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/time_entries") && options.method === "POST") {
      createPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ _type: "TimeEntry", id: 99 }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error(`Petición inesperada: ${url}`);
  };

  try {
    const entry = await createTimeEntry(
      {
        openprojectBaseUrl: "https://projects.example.test",
        openprojectToken: "test-token",
        openprojectProjectId: "101",
        openprojectWorkPackageId: "201",
        sendStartTime: false
      },
      {
        date: "2026-10-28",
        start: "08:00",
        end: "14:00",
        comment: "Viernes con tarea distinta",
        workPackageId: "202",
        activity: { id: 3, href: "/api/v3/time_entries/activities/3" }
      }
    );

    assert.equal(entry.id, 99);
    assert.equal(createPayload._links.entity.href, "/api/v3/work_packages/202");
    assert.equal(createPayload._links.project.href, "/api/v3/projects/101");
    assert.equal(createPayload._links.user, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("usa el proyecto indicado cuando se pasa por entrada", async () => {
  const originalFetch = globalThis.fetch;
  let createPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/time_entries") && options.method === "POST") {
      createPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ _type: "TimeEntry", id: 100 }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error(`Petición inesperada: ${url}`);
  };

  try {
    const entry = await createTimeEntry(
      {
        openprojectBaseUrl: "https://projects.example.test",
        openprojectToken: "test-token",
        openprojectProjectId: "101",
        openprojectWorkPackageId: "201",
        sendStartTime: false
      },
      {
        date: "2026-10-29",
        start: "08:00",
        end: "15:15",
        comment: "Día en otro proyecto",
        projectId: "102",
        workPackageId: "202",
        activity: { id: 3, href: "/api/v3/time_entries/activities/3" }
      }
    );

    assert.equal(entry.id, 100);
    assert.equal(createPayload._links.project.href, "/api/v3/projects/102");
    assert.equal(createPayload._links.entity.href, "/api/v3/work_packages/202");
    assert.equal(createPayload._links.user, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rechaza crear una entrada sin ningún work package", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no debería llamarse");
  };
  try {
    await assert.rejects(
      createTimeEntry(
        {
          openprojectBaseUrl: "https://projects.example.test",
          openprojectToken: "test-token",
          openprojectProjectId: "101",
          openprojectWorkPackageId: "",
          sendStartTime: false
        },
        {
          date: "2026-10-28",
          start: "08:00",
          end: "14:00",
          comment: "Sin tarea",
          workPackageId: "",
          activity: { id: 3 }
        }
      ),
      /work package/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("construye el payload de OpenProject con tramo y actividad", async () => {
  const originalFetch = globalThis.fetch;
  let createPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/users/me")) {
      return new Response(
        JSON.stringify({
          _type: "User",
          id: 28,
          name: "Rubén Serena",
          _links: { self: { href: "/api/v3/users/28" } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (String(url).endsWith("/time_entries") && options.method === "POST") {
      createPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ _type: "TimeEntry", id: 1234 }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`Petición inesperada: ${url}`);
  };

  try {
    const entry = await createTimeEntry(
      {
        openprojectBaseUrl: "https://projects.example.test",
        openprojectToken: "test-token",
        openprojectProjectId: "101",
        openprojectWorkPackageId: "201",
        sendStartTime: true
      },
      {
        date: "2026-10-26",
        start: "08:00",
        end: "15:15",
        comment: "Resumen del día",
        activity: { id: 3, href: "/api/v3/time_entries/activities/3" }
      }
    );

    assert.equal(entry.id, 1234);
    assert.equal(createPayload.spentOn, "2026-10-26");
    assert.equal(createPayload.hours, "PT7H15M");
    assert.equal(createPayload.startTime, localDateTimeToUTC("2026-10-26", "08:00"));
    assert.equal(createPayload.comment.raw, "Resumen del día");
    assert.equal(createPayload._links.project.href, "/api/v3/projects/101");
    assert.equal(createPayload._links.entity.href, "/api/v3/work_packages/201");
    assert.equal(createPayload._links.activity.href, "/api/v3/time_entries/activities/3");
    assert.equal(createPayload._links.user, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});