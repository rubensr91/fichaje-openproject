import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, isConfigured } from "../src/config.js";

test("el LLM por defecto apunta al endpoint compatible de Gemini", () => {
  assert.equal(
    DEFAULT_CONFIG.llmBaseUrl,
    "https://generativelanguage.googleapis.com/v1beta/openai"
  );
  assert.equal(DEFAULT_CONFIG.llmModel, "gemini-3.1-flash-lite");
});

test("la configuración base no exige tokens en el objeto no secreto", () => {
  assert.equal(
    isConfigured({
      gitlabBaseUrl: "https://gitlab.example.test",
      gitlabProject: "demo/project",
      openprojectBaseUrl: "https://openproject.example.test",
      openprojectProjectId: "101",
      openprojectWorkPackageId: "201"
    }),
    true
  );
});

test("el modo por defecto es todas las contribuciones", () => {
  assert.equal(DEFAULT_CONFIG.gitlabMode, "all");
  assert.equal(
    isConfigured({
      gitlabBaseUrl: "https://gitlab.example.test",
      gitlabProject: "",
      openprojectBaseUrl: "https://openproject.example.test",
      openprojectProjectId: "101",
      openprojectWorkPackageId: "201"
    }),
    true
  );
});

test("el modo proyecto exige el proyecto de GitLab", () => {
  assert.equal(
    isConfigured({
      gitlabBaseUrl: "https://gitlab.example.test",
      gitlabMode: "project",
      gitlabProject: "",
      openprojectBaseUrl: "https://openproject.example.test",
      openprojectProjectId: "101",
      openprojectWorkPackageId: "201"
    }),
    false
  );
});