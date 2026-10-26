import { requestJson, trimBase } from "./http.js";
import {
  buildEvidenceText,
  buildLlmMessagesFromText,
  fallbackSummary,
  normalizeEvidence
} from "./summary.js";
import { formatFindings, redactText } from "./redact.js";

function findingSummary(findings) {
  const types = formatFindings(findings);
  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  return `${total} posible(s) secreto(s)${types ? `: ${types}` : ""}`;
}

export async function summarize(config, { date, projectName, evidence }) {
  const local = fallbackSummary(evidence, projectName);

  if (!config.llmApiKey || !config.llmBaseUrl || !config.llmModel) {
    return {
      text: local,
      source: "local",
      warning: "Sin LLM configurado. Se usó el resumen local."
    };
  }

  const rawEvidence = buildEvidenceText(normalizeEvidence(evidence), date, projectName);
  const filtered = redactText(rawEvidence);
  const mode = config.llmFilterMode || "redact";

  if (filtered.count > 0 && mode === "block") {
    return {
      text: local,
      source: "local",
      warning: `Se detectaron ${findingSummary(filtered.findings)}. No se envió nada al LLM.`
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
        messages: buildLlmMessagesFromText(filtered.text)
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
      warning:
        filtered.count > 0
          ? `Se redactaron ${findingSummary(filtered.findings)} antes de enviar al LLM.`
          : null,
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