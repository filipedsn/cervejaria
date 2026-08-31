const MAX_FREE_TEXT_LENGTH = 1000;

const secretPatterns: RegExp[] = [
  /\b(authorization\s*:\s*bearer)\s+[^\s,;]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]+/gi,
  /\b(?:api[-_ ]?key|x-api-key)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:password|passwd|pwd|token|secret|key)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n;]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi,
  /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g
];

export function sanitizeFreeText(value: string, maxLength = MAX_FREE_TEXT_LENGTH): string {
  const redacted = secretPatterns.reduce(
    (text, pattern) => text.replace(pattern, '[REDACTED]'),
    value
  );
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

export { MAX_FREE_TEXT_LENGTH };
