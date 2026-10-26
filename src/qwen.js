import { requestJson, trimBase } from "./http.js";
import { buildQwenMessages, fallbackSummary, normalizeEvidence } from "./summary.js";

export async function summarize(config, { date, projectName, evidence }) {
  const local = fallbackSummary(evidence, projectName);

  if (!config.qwenApiKey) {
    return {
      text: local,
      source: "local",
      warning: "Sin API key de Qwen. Se usó el resumen local."
    };
  }

  try {
    const response = await requestJson(`${trimBase(config.qwenBaseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.qwenApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.qwenModel || "qwen3.6-flash",
        temperature: 0.2,
        max_tokens: 500,
        messages: buildQwenMessages(normalizeEvidence(evidence), date, projectName)
      }),
      timeoutMs: 45000
    });

    const text = response?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("Qwen devolvió una respuesta vacía");
    }

    return {
      text,
      source: "qwen",
      warning: null,
      usage: response.usage || null
    };
  } catch (error) {
    return {
      text: local,
      source: "local",
      warning: `Qwen no respondió (${error.message}). Se usó el resumen local.`
    };
  }
}