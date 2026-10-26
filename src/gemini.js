import { requestJson, trimBase } from "./http.js";
import { buildEvidenceText, fallbackSummary, normalizeEvidence } from "./summary.js";

const SYSTEM_INSTRUCTION =
  "Redactas partes de trabajo diarios en español para una herramienta de fichaje. " +
  "Resume únicamente el trabajo evidenciado en los datos. No inventes tareas, no menciones horas y no des consejos. " +
  "Devuelve solo el texto del resumen, en 2 a 5 líneas, con viñetas si ayuda. Sé concreto y técnico.";

export function buildGeminiRequest(evidence, date, projectName) {
  return {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildEvidenceText(normalizeEvidence(evidence), date, projectName) }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 500
    }
  };
}

function extractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("")
    .trim();
}

export async function summarize(config, { date, projectName, evidence }) {
  const local = fallbackSummary(evidence, projectName);

  if (!config.geminiApiKey) {
    return {
      text: local,
      source: "local",
      warning: "Sin API key de Gemini. Se usó el resumen local."
    };
  }

  try {
    const model = config.geminiModel || "gemini-3.1-flash";
    const base = trimBase(config.geminiBaseUrl || "https://generativelanguage.googleapis.com/v1beta");
    const response = await requestJson(
      `${base}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": config.geminiApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildGeminiRequest(evidence, date, projectName)),
        timeoutMs: 45000
      }
    );

    if (response?.promptFeedback?.blockReason) {
      throw new Error(`Gemini bloqueó la petición: ${response.promptFeedback.blockReason}`);
    }

    const text = extractText(response);
    if (!text) {
      throw new Error("Gemini devolvió una respuesta vacía");
    }

    return {
      text,
      source: "gemini",
      warning: null,
      usage: response.usageMetadata || null
    };
  } catch (error) {
    return {
      text: local,
      source: "local",
      warning: `Gemini no respondió (${error.message}). Se usó el resumen local.`
    };
  }
}