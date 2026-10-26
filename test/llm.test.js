import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/llm.js";

const evidence = {
  commits: [{ title: "feat: cabecera de cliente", message: "feat: cabecera de cliente" }],
  mergeRequests: [{ iid: 53, title: "Notificaciones", description: "", state: "merged" }],
  issues: []
};

test("llama a un endpoint compatible OpenAI y devuelve el texto", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;

  globalThis.fetch = async (url, options = {}) => {
    request = {
      url: String(url),
      headers: options.headers,
      body: JSON.parse(options.body)
    };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Resumen del día." } }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await summarize(
      {
        llmBaseUrl: "https://llm.example.test/v1",
        llmModel: "modelo-de-prueba",
        llmApiKey: "test-key"
      },
      { date: "2026-10-26", projectName: "demo/project", evidence }
    );

    assert.equal(result.source, "llm");
    assert.equal(result.text, "Resumen del día.");
    assert.match(request.url, /\/chat\/completions$/);
    assert.equal(request.headers.Authorization, "Bearer test-key");
    assert.equal(request.body.model, "modelo-de-prueba");
    assert.match(request.body.messages[0].content, /No inventes/);
    assert.match(request.body.messages[1].content, /2026-10-26/);
    assert.equal(request.body.temperature, 0.2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("usa el resumen local si no hay LLM configurado", async () => {
  const result = await summarize(
    { llmBaseUrl: "", llmModel: "", llmApiKey: "" },
    { date: "2026-10-26", projectName: "demo/project", evidence }
  );
  assert.equal(result.source, "local");
  assert.match(result.text, /cabecera de cliente/);
  assert.match(result.warning, /Sin LLM configurado/);
});

test("bloquea el envío si detecta un secreto", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("no debería llamarse");
  };

  try {
    const result = await summarize(
      {
        llmBaseUrl: "https://llm.example.test/v1",
        llmModel: "modelo-de-prueba",
        llmApiKey: "test-key",
        llmFilterMode: "block"
      },
      {
        date: "2026-10-26",
        projectName: "demo/project",
        evidence: {
          commits: [
            {
              title: "fix: credenciales",
              message: "config password=super-secreto-123"
            }
          ]
        }
      }
    );

    assert.equal(called, false);
    assert.equal(result.source, "local");
    assert.match(result.warning, /No se envió nada al LLM/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redacta secretos antes de enviarlos al LLM", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Resumen limpio." } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await summarize(
      {
        llmBaseUrl: "https://llm.example.test/v1",
        llmModel: "modelo-de-prueba",
        llmApiKey: "test-key",
        llmFilterMode: "redact"
      },
      {
        date: "2026-10-26",
        projectName: "demo/project",
        evidence: {
          commits: [
            {
              title: "fix: credenciales",
              message: "config password=super-secreto-123"
            }
          ]
        }
      }
    );

    const sent = request.messages[1].content;
    assert.equal(sent.includes("super-secreto-123"), false);
    assert.match(sent, /\[REDACTED/);
    assert.equal(result.source, "llm");
    assert.match(result.warning, /Se redactaron/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});