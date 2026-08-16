/**
 * Recursive redaction for anything written into AuditLog.beforeData/
 * afterData/metadata. Mandatory per CLAUDE.md: audit logs must never
 * contain passwords, hashes, tokens, secrets, or authentication material —
 * this is the single centralized guard so no caller has to remember to
 * strip fields by hand (see docs/audit-architecture.md).
 *
 * Matching is substring-based on a normalized (lowercased, non-alpha
 * stripped) key name, so "passwordHash", "PASSWORD_HASH", and
 * "current_password" are all caught by the same "password" pattern.
 * False positives (redacting something harmless) are an acceptable
 * trade-off; false negatives are not.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'privatekey',
  'apikey',
  'cardnumber',
  'cvv',
  'certificate',
];

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 10;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return '[REDACTED_DEPTH_LIMIT]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

export const AuditSanitizer = {
  /** Deep-clones `value` while redacting any key matching a sensitive pattern at any nesting level. */
  sanitize(value: unknown): unknown {
    if (value === undefined || value === null) {
      return value;
    }
    return sanitizeValue(value, 0);
  },
};
