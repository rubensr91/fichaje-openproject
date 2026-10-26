import { requestJson, trimBase } from "./http.js";
import { buildLlmMessages, fallbackSummary, normalizeEvidence } from "./summary.js";

export async function summarize(config, { date, projectName, evidence }) {
  const local = fallbackSummary(evidence, projectName);

  if (!config.llmApiKey || !config.llmBaseUrl || !config.llmModel) {
    return {
      text: local,
      source: "local",
      warning: "Sin LLM configurado. Se usó el resumen local."
    };
  }

  try {
    const response = await requestJson(`${trimBase(config.llmBaseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llmApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.2,
        max_tokens: 500,
        messages: buildLlmMessages(normalizeEvidence(evidence), date, projectName)
      }),
      timeoutMs: 45000
    });

    const text = response?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("El LLM devolvió una respuesta vacía");
    }

    return {
      text,
      source: "llm",
      warning: null,
      usage: response.usage || null
    };
  } catch (error) {
    return {
      text: local,
      source: "local",
      warning: `El LLM no respondió (${error.message}). Se usó el resumen local.`
    };
  }
}