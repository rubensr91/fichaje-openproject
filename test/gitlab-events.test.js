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
  gitlabMode: "all",
  gitlabAuthor: "ruben"
};

const pushEvent = (day, hour, project = 10) => ({
  action_name: "pushed to",
  created_at: `${day}T${hour}:00Z`,
  project_id: project,
  push_data: { commit_title: "feat: ultimo commit", commit_count: 3, ref: "main" }
});

const PROJECTS = {
  10: { id: 10, name: "web", path_with_namespace: "grupo/web", web_url: "https://gitlab.example.test/grupo/web" },
  20: { id: 20, name: "api", path_with_namespace: "grupo/api", web_url: "https://gitlab.example.test/grupo/api" }
};

function mockGitlab({ events, commitsByProject, commitsError = false, projectError = false }) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);

    if (target.includes("/api/v4/user")) {
      return jsonResponse({ id: 7, username: "ruben", name: "Rubén", email: "ruben@ejemplo.es" });
    }
    if (target.includes("/api/v4/events")) {
      return jsonResponse(events);
    }
    const projectMatch = /\/api\/v4\/projects\/(\d+)(?=\/|\?|$)/.exec(target);
    if (projectMatch) {
      const projectId = Number(projectMatch[1]);
      if (projectError) {
        return new Response("no existe", { status: 404 });
      }
      if (target.includes("/repository/commits")) {
        if (commitsError) {
          return new Response("error", { status: 500 });
        }
        return jsonResponse(commitsByProject[projectId] || []);
      }
      if (target.includes("/merge_requests") || target.includes("/issues")) {
        return jsonResponse([]);
      }
      return jsonResponse(PROJECTS[projectId]);
    }
    throw new Error(`Petición inesperada: ${target}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("enriquece los eventos con el detalle completo por proyecto", async () => {
  const mock = mockGitlab({
    events: [
      pushEvent("2026-10-26", "09:00", 10),
      pushEvent("2026-10-26", "10:00", 10),
      pushEvent("2026-10-26", "11:00", 20),
      {
        action_name: "created",
        created_at: "2026-10-26T12:00:00Z",
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
      // Otro día: debe descartarse en cualquier zona horaria.
      pushEvent("2026-10-30", "12:00", 10)
    ],
    commitsByProject: {
      10: [
        { title: "feat: login", message: "feat: login", author_name: "ruben", author_email: "ruben@ejemplo.es", created_at: "2026-10-26T08:50:00Z" },
        { title: "fix: rutas", message: "fix: rutas", author_name: "ruben", author_email: "ruben@ejemplo.es", created_at: "2026-10-26T09:55:00Z" }
      ],
      20: [
        { title: "feat: endpoint", message: "feat: endpoint", author_name: "ruben", author_email: "ruben@ejemplo.es", created_at: "2026-10-26T10:40:00Z" }
      ]
    }
  });

  try {
    const day = await fetchDayAll(config, "2026-10-26");

    // 3 commits reales (2 + 1) + 1 comentario. Sin duplicar el push de eventos.
    assert.equal(day.counts.commits, 4);
    assert.equal(day.counts.mergeRequests, 1);
    assert.equal(day.counts.issues, 1);

    assert.ok(day.commits.some((commit) => commit.title === "feat: login"));
    assert.ok(day.commits.some((commit) => commit.title === "feat: endpoint"));
    assert.ok(day.commits.some((commit) => commit.title.includes("comentario: Revisado en reunión")));
    assert.ok(day.commits.every((commit) => !commit.title.includes("ultimo commit")));

    // Proyecto estructural en cada item, sin prefijos en el título.
    assert.deepEqual(day.projects, ["grupo/web", "grupo/api"]);
    assert.equal(day.project.path, "grupo/web");
    assert.equal(
      day.commits.find((commit) => commit.title === "feat: login").project,
      "grupo/web"
    );
    assert.equal(
      day.commits.find((commit) => commit.title === "feat: endpoint").project,
      "grupo/api"
    );

    // MR del respaldo de eventos: título limpio + campo project.
    assert.equal(day.mergeRequests[0].title, "Notificaciones");
    assert.equal(day.mergeRequests[0].project, "grupo/web");
    assert.equal(day.mergeRequests[0].description, "");

    // Issue con estado real.
    assert.equal(day.issues[0].state, "closed");

    // Sin aviso cuando todo el detalle está disponible.
    assert.equal(day.warning, null);

    // Metadatos pedidos una vez por proyecto distinto.
    const metaCalls = mock.calls.filter(
      (url) => /\/api\/v4\/projects\/\d+\?/.test(url) && !url.includes("/repository/") && !url.includes("/merge_requests") && !url.includes("/issues")
    );
    assert.equal(metaCalls.length, 2);
  } finally {
    mock.restore();
  }
});

test("si falla el detalle de un proyecto, usa los eventos como respaldo", async () => {
  const mock = mockGitlab({
    events: [pushEvent("2026-10-26", "09:00", 10)],
    commitsByProject: {},
    commitsError: true
  });

  try {
    const day = await fetchDayAll(config, "2026-10-26");

    // Respaldo: el push del evento entra como item con su proyecto.
    assert.equal(day.counts.commits, 1);
    assert.equal(day.commits[0].title, "feat: ultimo commit");
    assert.equal(day.commits[0].project, "grupo/web");
    assert.deepEqual(day.projects, ["grupo/web"]);
    assert.match(day.warning, /no disponible/);
  } finally {
    mock.restore();
  }
});

test("recoge MRs merged por ti aunque las creara otra persona", async () => {
  const mock = mockGitlab({
    events: [
      {
        action_name: "merged",
        created_at: "2026-10-26T14:00:00Z",
        project_id: 10,
        target_type: "MergeRequest",
        target_iid: 77,
        target_title: "MR de otra persona"
      }
    ],
    commitsByProject: { 10: [] }
  });

  try {
    const day = await fetchDayAll(config, "2026-10-26");
    // Sin commits propios y sin MRs propias en el detalle, el evento añade la MR merged.
    assert.equal(day.counts.mergeRequests, 1);
    assert.match(day.mergeRequests[0].title, /MR de otra persona/);
    assert.equal(day.mergeRequests[0].state, "merged");
    assert.equal(day.counts.commits, 0);
  } finally {
    mock.restore();
  }
});

test("cada día del rango recibe su propia actividad", async () => {
  const mock = mockGitlab({
    events: [pushEvent("2026-10-26", "09:00", 10), pushEvent("2026-10-30", "09:00", 10)],
    commitsByProject: {},
    commitsError: true
  });

  try {
    const days = await fetchRangeAll(config, ["2026-10-26", "2026-10-30"]);
    // Detalle no disponible: ambos días caen al respaldo de eventos,
    // cada uno con su propio push y su propia ventana de eventos.
    assert.equal(days.length, 2);
    assert.equal(days[0].counts.commits, 1);
    assert.equal(days[1].counts.commits, 1);
    const eventCalls = mock.calls.filter((url) => url.includes("/api/v4/events"));
    assert.equal(eventCalls.length, 2);
    assert.match(eventCalls[0], /after=2026-10-25/);
    assert.match(eventCalls[1], /after=2026-10-29/);
  } finally {
    mock.restore();
  }
});
