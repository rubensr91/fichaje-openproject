import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/gemini.js";

const evidence = {
  commits: [{ title: "feat: cabecera de cliente", message: "feat: cabecera de cliente" }],
  mergeRequests: [{ iid: 53, title: "Notificaciones", description: "", state: "merged" }],
  issues: []
};

test("llama a Gemini 3.1 Flash y devuelve el texto", async () => {
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
        candidates: [{ content: { parts: [{ text: "Resumen Gemini del día." }] } }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await summarize(
      {
        geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        geminiModel: "gemini-3.1-flash",
        geminiApiKey: "test-key"
      },
      { date: "2026-10-26", projectName: "demo/project", evidence }
    );

    assert.equal(result.source, "gemini");
    assert.equal(result.text, "Resumen Gemini del día.");
    assert.match(request.url, /\/models\/gemini-3\.1-flash:generateContent$/);
    assert.equal(request.headers["x-goog-api-key"], "test-key");
    assert.match(request.body.systemInstruction.parts[0].text, /No inventes/);
    assert.match(request.body.contents[0].parts[0].text, /2026-10-26/);
    assert.equal(request.body.generationConfig.temperature, 0.2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("usa el resumen local si falta la API key de Gemini", async () => {
  const result = await summarize(
    { geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    { date: "2026-10-26", projectName: "demo/project", evidence }
  );
  assert.equal(result.source, "local");
  assert.match(result.text, /cabecera de cliente/);
  assert.match(result.warning, /Sin API key/);
});