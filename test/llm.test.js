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