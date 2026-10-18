export class ProviderHttp {
  private cache = new Map<string, { until: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;

  constructor(private readonly name: string, private readonly base: string,
    private readonly headers: Record<string, string>, private readonly ttlMs: number,
    private readonly fetcher: typeof fetch = fetch) {}

  async request(path: string, body?: unknown, force = false): Promise<unknown> {
    const key = path + (body === undefined ? "" : JSON.stringify(body));
    const cached = this.cache.get(key);
    if (!force && cached && cached.until > Date.now()) return structuredClone(cached.value);
    const pending = this.pending.get(key);
    if (pending) return structuredClone(await pending);
    if (Date.now() < this.blockedUntil) throw new Error(`${this.name}: cooldown akses/kuota.`);
    const task = this.fetchJson(path, body).then((value) => {
      if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + this.ttlMs, value });
      return value;
    });
    this.pending.set(key, task);
    try { return structuredClone(await task); } finally { this.pending.delete(key); }
  }

  private async fetchJson(path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await this.fetcher(this.base + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { ...this.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        if ([401, 402, 403, 429].includes(response.status)) {
          const retry = Number(response.headers.get("retry-after"));
          this.blockedUntil = Date.now() + Math.min(3600, Math.max(60, Number.isFinite(retry) ? retry : 300)) * 1000;
        }
        throw new Error();
      }
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error();
      return JSON.parse(text);
    } catch {
      // Never expose provider URLs, response bodies, or authentication details.
      throw new Error(`${this.name}: query gagal, data enrichment belum tersedia.`);
    }
  }
}
