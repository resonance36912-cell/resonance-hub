const PRIVATE_KEY_RE =
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi;

export function redactForIndex(text: string): string {
  let redacted = text.replace(PRIVATE_KEY_RE, "[REDACTED:PRIVATE_KEY]");

  redacted = redacted.replace(
    /(Authorization\s*:\s*Bearer\s+)([^\s]+)/gi,
    "$1[REDACTED:TOKEN]",
  );

  redacted = redacted.replace(
    /(\bpassword\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi,
    "$1[REDACTED:PASSWORD]",
  );

  redacted = redacted.replace(
    /(\b(?:api[_-]?key|access[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi,
    "$1[REDACTED:API_KEY]",
  );

  // This replacement removes secrets; the replacement text is a public redaction marker.
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
  redacted = redacted.replace(
    /(\b(?:token|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi,
    "$1[REDACTED:TOKEN]",
  );

  return redacted;
}
