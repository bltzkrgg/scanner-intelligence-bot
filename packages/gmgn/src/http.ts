import { ZodError } from "zod";

export class ProviderDataError extends Error {}

export class ProviderHttpError extends Error {
  constructor(readonly provider: string, readonly reason: string, readonly status?: number) {
    super(`${provider}: ${reason}`);
  }
}

export class ProviderHttp {
  private cache = new Map<string, { until: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;
  private blockedStatus?: number;

  constructor(private readonly name: string, private readonly base: string,
    private readonly headers: Record<string, string>, private readonly ttlMs: number,
    private readonly fetcher: typeof fetch = fetch) {}

  async request(path: string, body?: unknown, force = false, ttlMs = this.ttlMs): Promise<unknown> {
    const key = path + (body === undefined ? "" : JSON.stringify(body));
    const cached = this.cache.get(key);
    if (!force && cached && cached.until > Date.now()) return structuredClone(cached.value);
    const pending = this.pending.get(key);
    if (pending) return structuredClone(await pending);
    if (Date.now() < this.blockedUntil) throw new ProviderHttpError(this.name, `cooldown setelah HTTP ${this.blockedStatus}.`, this.blockedStatus);
    const task = this.fetchJson(path, body).then((value) => {
      if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + ttlMs, value });
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
          const header = response.headers.get("retry-after");
          const retry = header === null ? 300 : Number(header);
          this.blockedUntil = Date.now() + Math.min(3600, Math.max(60, Number.isFinite(retry) ? retry : 300)) * 1000;
          this.blockedStatus = response.status;
        }
        const reasons: Record<number, string> = { 401: "key tidak diterima", 402: "kredit/kuota habis",
          403: "akses ditolak; periksa izin/paket/IP", 404: "token/wallet atau endpoint tidak ditemukan", 429: "rate limit" };
        throw new ProviderHttpError(this.name, `HTTP ${response.status}: ${reasons[response.status] ?? "query provider gagal"}.`, response.status);
      }
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new ProviderHttpError(this.name, "respons terlalu besar.");
      try { return JSON.parse(text); }
      catch { throw new ProviderHttpError(this.name, "respons bukan JSON valid."); }
    } catch (error) {
      // Never expose provider URLs, response bodies, or authentication details.
      if (error instanceof ProviderHttpError) throw error;
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      throw new ProviderHttpError(this.name, timeout ? "timeout query (8 detik)." : "koneksi/query gagal.");
    }
  }
}

export function providerFailureReason(name: string, error: unknown): string {
  if (error instanceof ProviderHttpError || error instanceof ProviderDataError) return error.message;
  if (error instanceof ZodError) {
    // Report schema field names only, never rejected values or the raw Zod message.
    const allowed = new Set(["deployer", "wallet_address", "total_tokens_deployed", "total_bonded", "deployer_address",
      "tokens_deployed", "graduated", "graduation_rate", "token", "address", "scope", "holders", "handle", "amount",
      "window", "capturedAt", "traders", "rank", "userId", "list", "amount_percentage", "addr_type", "native_transfer",
      "from_address", "chain", "result", "value", "owner", "data", "parsed", "type", "info", "mintAuthority", "freezeAuthority"]);
    const paths = error.issues.slice(0, 3).map((i) => i.path.slice(0, 5).map((part) =>
      typeof part === "number" ? "[]" : allowed.has(String(part)) ? String(part) : "field").join(".") || "root");
    return `${name}: format respons API tidak sesuai parser (field: ${paths.join(", ")}).`;
  }
  return `${name}: format respons API tidak sesuai parser atau identitas data tidak cocok.`;
}
