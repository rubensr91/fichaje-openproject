const RULES = [
  {
    type: "gitlab_token",
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:GITLAB_TOKEN]"
  },
  {
    type: "openproject_token",
    regex: /\bopapi-[a-f0-9]{20,}\b/gi,
    replacement: "[REDACTED:OPENPROJECT_TOKEN]"
  },
  {
    type: "google_api_key",
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replacement: "[REDACTED:GOOGLE_API_KEY]"
  },
  {
    type: "llm_api_key",
    regex: /\bsk-(?:proj-|sp-)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:LLM_API_KEY]"
  },
  {
    type: "github_token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED:GITHUB_TOKEN]"
  },
  {
    type: "github_pat",
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED:GITHUB_TOKEN]"
  },
  {
    type: "aws_access_key",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED:AWS_KEY]"
  },
  {
    type: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED:JWT]"
  },
  {
    type: "private_key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]"
  },
  {
    type: "authorization_header",
    regex: /\b(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: "[REDACTED:AUTHORIZATION]"
  },
  {
    type: "url_credentials",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi,
    replacement: "[REDACTED:URL_CREDENTIALS]"
  },
  {
    type: "bearer_token",
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
    replacement: "[REDACTED:BEARER_TOKEN]"
  },
  {
    type: "secret_assignment",
    regex:
      /(\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?)([^\s"'`,;]{6,})/gi,
    replacement: (_match, prefix) => `${prefix}[REDACTED:SECRET]`
  }
];

export function redactText(input) {
  let text = String(input || "");
  const findings = [];

  for (const rule of RULES) {
    let count = 0;
    text = text.replace(rule.regex, (...args) => {
      count += 1;
      return typeof rule.replacement === "function"
        ? rule.replacement(...args)
        : rule.replacement;
    });
    if (count > 0) {
      findings.push({ type: rule.type, count });
    }
  }

  return {
    text,
    findings,
    count: findings.reduce((total, finding) => total + finding.count, 0)
  };
}

export function formatFindings(findings) {
  return findings.map((finding) => finding.type).join(", ");
}