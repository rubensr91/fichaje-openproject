import test from "node:test";
import assert from "node:assert/strict";
import { fetchDayAll, fetchRangeAll } from "../src/gitlab.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const config = {
  gitlabBaseUrl: "https://gitlab.example.test",
  gitlabProject: "",
  gitlabToken: "test-token",
  gitlabMode: "all"
};

const pushEvent = (day, hour, project = 10) => ({
  action_name: "pushed to",
  created_at: `${day}T${hour}:00Z`,
  project_id: project,
  push_data: { commit_title: "feat: ultimo commit", commit_count: 3, ref: "main" }
});

test("agrega eventos de todos los proyectos en un día", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);

    if (target.includes("/api/v4/user")) {
      return jsonResponse({ id: 7, username: "ruben", name: "Rubén", email: "ruben@ejemplo.es" });
    }
    if (target.includes("/api/v4/events")) {
      return jsonResponse([
        pushEvent("2026-10-26", "09:00", 10),
        pushEvent("2026-10-26", "10:00", 10),
        {
          action_name: "pushed to",
          created_at: "2026-10-26T11:00:00Z",
          project_id: 20,
          push_data: { commit_title: "fix: otro proyecto", commit_count: 1, ref: "dev" }
        },
        {
          action_name: "created",
          created_at: "2026-10-26T12:00:00Z",
          project_id: 10,
          target_type: "MergeRequest",
          target_iid: 53,
          target_title: "Notificaciones"
        },
        {
          action_name: "merged",
          created_at: "2026-10-26T14:00:00Z",
          project_id: 10,
          target_type: "MergeRequest",
          target_iid: 53,
          target_title: "Notificaciones"
        },
        {
          action_name: "closed",
          created_at: "2026-10-26T15:00:00Z",
          project_id: 20,
          target_type: "Issue",
          target_iid: 8,
          target_title: "Bug grave"
        },
        {
          action_name: "commented",
          created_at: "2026-10-26T16:00:00Z",
          project_id: 10,
          target_type: "Note",
          target_title: "Revisado en reunión"
        },
        // Fuera del rango local del día en cualquier zona horaria: debe descartarse.
        {
          action_name: "pushed to",
          created_at: "2026-10-30T12:00:00Z",
          project_id: 10,
          push_data: { commit_title: "commit de otro día", commit_count: 1, ref: "main" }
        }
      ]);
    }
    if (/\/api\/v4\/projects\/(10|20)(\?|$)/.test(target)) {
      const id = new URL(target).pathname.split("/").pop();
      return jsonResponse({ id: Number(id), name: `proyecto-${id}`, path_with_namespace: `grupo/proyecto-${id}` });
    }
    throw new Error(`Petición inesperada: ${target}`);
  };

  try {
    const day = await fetchDayAll(config, "2026-10-26");

    assert.equal(day.date, "2026-10-26");
    assert.equal(day.project.path, "Todas las contribuciones");

    // 3 pushes dentro del día + 1 comentario; el push del día siguiente se excluye.
    assert.equal(day.counts.commits, 4);
    assert.equal(day.counts.mergeRequests, 1);
    assert.equal(day.counts.issues, 1);

    const mr = day.mergeRequests[0];
    assert.match(mr.title, /\[grupo\/proyecto-10\] Notificaciones/);
    // El evento merged (posterior) pisa el estado de created.
    assert.equal(mr.state, "merged");

    const issue = day.issues[0];
    assert.equal(issue.state, "closed");
    assert.match(issue.title, /\[grupo\/proyecto-20\] Bug grave/);

    const withPrefix = day.commits.filter((commit) => commit.title.includes("[grupo/proyecto-"));
    assert.equal(withPrefix.length, 4);
    assert.ok(day.commits.every((commit) => !commit.title.includes("otro día")));

    // Nombres de proyecto pedidos una sola vez por id distinto.
    const projectCalls = calls.filter((url) => /\/api\/v4\/projects\/\d+/.test(url));
    assert.equal(projectCalls.length, 2);

    // Ventana amplia en el endpoint de eventos.
    const eventCalls = calls.filter((url) => url.includes("/api/v4/events"));
    assert.equal(eventCalls.length, 1);
    assert.match(eventCalls[0], /after=2026-10-25/);
    assert.match(eventCalls[0], /before=2026-10-28/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRangeAll funciona para varios días", async () => {
  const originalFetch = globalThis.fetch;
  let eventCalls = 0;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/api/v4/user")) {
      return jsonResponse({ id: 7, username: "ruben", name: "Rubén" });
    }
    if (target.includes("/api/v4/events")) {
      eventCalls += 1;
      const day = eventCalls === 1 ? "2026-10-26" : "2026-10-30";
      return jsonResponse([pushEvent(day, "09:00")]);
    }
    if (/\/api\/v4\/projects\/10(\?|$)/.test(target)) {
      return jsonResponse({ id: 10, name: "web", path_with_namespace: "demo/web" });
    }
    throw new Error(`Petición inesperada: ${target}`);
  };

  try {
    const days = await fetchRangeAll(config, ["2026-10-26", "2026-10-30"]);
    assert.equal(days.length, 2);
    assert.equal(days[0].counts.commits, 1);
    assert.equal(days[1].counts.commits, 1);
    assert.equal(eventCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
