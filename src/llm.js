import { summarize as summarizeGemini } from "./gemini.js";
import { summarize as summarizeQwen } from "./qwen.js";

export async function summarize(config, context) {
  if ((config.llmProvider || "gemini") === "qwen") {
    return summarizeQwen(config, context);
  }
  return summarizeGemini(config, context);
}