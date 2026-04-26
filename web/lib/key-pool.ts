/**
 * ApiKeyPool — round-robin pool of API keys for a single provider, with
 * per-key health tracking and automatic cooldown on rate-limit / server errors.
 *
 * Use case: free-tier Gemini caps each key at ~5 RPM. With three keys in the
 * pool a demo session sees 15 RPM and weathers per-key 429s without surfacing
 * an error to the user.
 *
 * The pool is a singleton per Node process (per Vercel function instance).
 * State is in-memory; if Vercel scales to multiple instances each instance has
 * its own view of key health, which is acceptable — the worst case is a 45 s
 * cooldown that one instance learnt about and another instance retries against
 * a still-cooling key, gets another 429, and learns it itself.
 */

interface KeyEntry {
  value: string;
  /** Wall-clock (ms) until which this key is considered unhealthy. */
  cooldownUntil: number;
  failures: number;
  successes: number;
  lastUsedAt: number;
}

export type FailureKind = "rate_limit" | "server_error" | "non_retryable";

export class ApiKeyPool {
  private readonly entries: KeyEntry[];
  private cursor = 0;

  constructor(public readonly name: string, keys: string[]) {
    this.entries = keys.map((value) => ({
      value,
      cooldownUntil: 0,
      failures: 0,
      successes: 0,
      lastUsedAt: 0,
    }));
  }

  size(): number {
    return this.entries.length;
  }

  healthyCount(): number {
    const now = Date.now();
    return this.entries.filter((k) => k.cooldownUntil <= now).length;
  }

  /**
   * Pick the next eligible key (round-robin among healthy entries, skipping
   * any in `exclude`). Returns null if every key is cooling down or excluded.
   */
  pick(exclude: ReadonlySet<string> = new Set()): { key: string; index: number } | null {
    if (this.entries.length === 0) return null;
    const now = Date.now();

    for (let step = 0; step < this.entries.length; step++) {
      const idx = (this.cursor + step) % this.entries.length;
      const entry = this.entries[idx];
      if (entry.cooldownUntil > now) continue;
      if (exclude.has(entry.value)) continue;
      this.cursor = (idx + 1) % this.entries.length;
      entry.lastUsedAt = now;
      return { key: entry.value, index: idx };
    }
    return null;
  }

  reportSuccess(key: string): void {
    const e = this.entries.find((x) => x.value === key);
    if (!e) return;
    e.successes++;
    e.failures = Math.max(0, e.failures - 1);
  }

  reportFailure(key: string, kind: FailureKind): void {
    const e = this.entries.find((x) => x.value === key);
    if (!e) return;
    e.failures++;
    if (kind === "rate_limit") {
      // Gemini free-tier suggests ~45s; we honour that with a 5s jitter.
      e.cooldownUntil = Date.now() + 45_000 + Math.floor(Math.random() * 5_000);
    } else if (kind === "server_error") {
      e.cooldownUntil = Date.now() + 5_000;
    }
  }

  /** For diagnostic / debug surfaces. Keys are NOT exposed; only metadata. */
  status() {
    const now = Date.now();
    return this.entries.map((k, i) => ({
      index: i,
      healthy: k.cooldownUntil <= now,
      cooldownMs: Math.max(0, k.cooldownUntil - now),
      failures: k.failures,
      successes: k.successes,
    }));
  }
}

/** Read keys from env, supporting both single + comma-separated forms. */
export function loadKeys(envBase: string): string[] {
  const plural = process.env[`${envBase}S`];
  if (plural) {
    const parts = plural
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts;
  }
  const single = process.env[envBase];
  if (single) return [single.trim()];

  // Numbered fallback: GEMINI_API_KEY_1, _2, ...
  const numbered: string[] = [];
  for (let i = 1; i <= 16; i++) {
    const v = process.env[`${envBase}_${i}`];
    if (v) numbered.push(v.trim());
  }
  return numbered;
}

/** Module-scoped singleton(s). Instantiated lazily on first read. */
let _geminiPool: ApiKeyPool | null = null;

export function geminiKeyPool(): ApiKeyPool {
  if (_geminiPool === null) {
    _geminiPool = new ApiKeyPool("gemini", loadKeys("GEMINI_API_KEY"));
  }
  return _geminiPool;
}

/** Classify an error from a provider call into a retry kind. */
export function classifyProviderError(err: unknown): FailureKind {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) return "rate_limit";
  if (/\b5\d\d\b|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|TIMEOUT/i.test(msg)) return "server_error";
  return "non_retryable";
}
