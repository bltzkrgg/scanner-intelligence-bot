import { ZodError } from "zod";
import { curlFetch } from "./curl-fetch.js";

export class ProviderDataError extends Error {}

export class ProviderHttpError extends Error {
  constructor(readonly provider: string, readonly reason: string, readonly status?: number) {
    super(`${provider}: ${reason}`);
  }
}

export function transportFailureReason(error: unknown): string {
  const reasons: Record<string, string> = {
    ENOTFOUND: "DNS: host tidak ditemukan", EAI_AGAIN: "DNS: resolusi sementara gagal",
    ECONNREFUSED: "koneksi ditolak", ECONNRESET: "koneksi direset", ENETUNREACH: "jaringan tidak terjangkau",
    EHOSTUNREACH: "host tidak terjangkau", ETIMEDOUT: "koneksi timeout",
    UND_ERR_CONNECT_TIMEOUT: "timeout saat membuka koneksi", UND_ERR_HEADERS_TIMEOUT: "timeout menunggu header",
    UND_ERR_BODY_TIMEOUT: "timeout membaca respons", UND_ERR_SOCKET: "socket terputus",
    CERT_HAS_EXPIRED: "TLS: sertifikat kedaluwarsa", CERT_NOT_YET_VALID: "TLS: sertifikat belum berlaku",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS: rantai sertifikat tidak dapat diverifikasi",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS: CA penerbit tidak ditemukan",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS: sertifikat self-signed",
    SELF_SIGNED_CERT_IN_CHAIN: "TLS: sertifikat self-signed dalam chain",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS: hostname sertifikat tidak cocok",
    ERR_SSL_WRONG_VERSION_NUMBER: "TLS: versi protokol tidak cocok",
    ERR_INVALID_CHAR: "header request mengandung karakter tidak valid",
    UND_ERR_INVALID_ARG: "argumen request tidak valid"
  };
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const found = new Set<string>();
  for (let i = 0; i < queue.length && i < 12; i++) {
    const item = queue[i];
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const e = item as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    if (e.name === "TimeoutError" || e.name === "AbortError") found.add("timeout query (8 detik)");
    if (typeof e.code === "string" && Object.hasOwn(reasons, e.code)) found.add(`${e.code}: ${reasons[e.code]}`);
    if (e.cause) queue.push(e.cause);
    if (Array.isArray(e.errors)) queue.push(...e.errors.slice(0, 4));
  }
  const reason = found.size ? `${[...found].slice(0, 3).join("; ")}.` : "koneksi/query gagal (kode transport tidak tersedia).";
  return reason.length > 160 ? `${reason.slice(0, 157)}...` : reason;
}

export class ProviderHttp {
  private cache = new Map<string, { until: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;
  private blockedStatus?: number;
  private recoveryUntil = 0;

  constructor(private readonly name: string, private readonly base: string,
    private readonly headers: Record<string, string>, private readonly ttlMs: number,
    private readonly fetcher: typeof fetch = fetch,
    private readonly recovery: typeof fetch | undefined = fetcher === fetch ? curlFetch : undefined) {}

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
      const options: RequestInit = {
        method: body === undefined ? "GET" : "POST", redirect: "manual",
        headers: { accept: "application/json", ...this.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
      };
      let response: Response;
      const request = body === undefined && this.recovery && Date.now() < this.recoveryUntil ? this.recovery : this.fetcher;
      try { response = await request(this.base + path, options); }
      catch (error) {
        if (body !== undefined || !this.recovery || request === this.recovery) throw error;
        // A verified system transport can recover Node trust-store/proxy/socket failures, not HTTP denials.
        try {
          response = await this.recovery(this.base + path, { ...options, signal: AbortSignal.timeout(8000) });
          if (response.ok) this.recoveryUntil = Date.now() + 300000;
        }
        catch { throw new ProviderHttpError(this.name, `${transportFailureReason(error)} Pemulihan curl juga gagal; akses belum pulih.`); }
      }
      if (!response.ok) {
        if (response.status >= 300 && response.status < 400) {
          throw new ProviderHttpError(this.name, `HTTP ${response.status}: redirect ditolak; kredensial tidak diteruskan.`, response.status);
        }
        if ([401, 402, 403, 429].includes(response.status)) {
          const header = response.headers.get("retry-after");
          const retry = header === null ? 300 : Number(header);
          this.blockedUntil = Date.now() + Math.min(3600, Math.max(60, Number.isFinite(retry) ? retry : 300)) * 1000;
          this.blockedStatus = response.status;
        }
        const reasons: Record<number, string> = { 401: "key tidak diterima", 402: "kredit/kuota habis",
          403: "akses ditolak; periksa izin/paket/IP", 404: "token/wallet atau endpoint tidak ditemukan", 429: "rate limit" };
        const contentType = response.headers.get("content-type") ?? "";
        const format = /text\/html/i.test(contentType) ? "HTML" : /application\/(?:[\w.-]+\+)?json/i.test(contentType) ? "JSON" : "lain/tidak diketahui";
        throw new ProviderHttpError(this.name, `HTTP ${response.status}: ${reasons[response.status] ?? "query provider gagal"}. Jenis respons: ${format}.`, response.status);
      }
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new ProviderHttpError(this.name, "respons terlalu besar.");
      try { return JSON.parse(text); }
      catch { throw new ProviderHttpError(this.name, "respons bukan JSON valid."); }
    } catch (error) {
      // Never expose provider URLs, response bodies, or authentication details.
      if (error instanceof ProviderHttpError) throw error;
      throw new ProviderHttpError(this.name, transportFailureReason(error));
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
