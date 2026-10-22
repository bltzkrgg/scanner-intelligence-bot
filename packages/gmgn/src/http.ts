import { ZodError } from "zod";
import { curlFetch } from "./curl-fetch.js";

export class ProviderDataError extends Error {}

export interface ProviderHttpDetails {
  format: "HTML" | "JSON" | "other";
  requestId?: string;
  code?: string;
  yourTier?: string;
  requiredTier?: string;
}

export class ProviderHttpError extends Error {
  constructor(readonly provider: string, readonly reason: string, readonly status?: number,
    readonly details?: ProviderHttpDetails) {
    super(`${provider}: ${reason}`);
  }
}

async function madeOnSolFailure(response: Response, secrets: string[]): Promise<{ reason: string; details: ProviderHttpDetails }> {
  const contentType = response.headers.get("content-type") ?? "";
  const format = /text\/html/i.test(contentType) ? "HTML"
    : /application\/(?:[\w.-]+\+)?json/i.test(contentType) ? "JSON" : "other";
  const details: ProviderHttpDetails = { format };
  const requestId = response.headers.get("x-request-id");
  if (requestId && /^[A-Za-z0-9_-]{1,256}$/.test(requestId) && !secrets.some((s) => s && requestId.includes(s))) {
    details.requestId = requestId;
  }
  let reason = format === "HTML" ? "respons HTML, bukan error JSON API; penyebab penolakan belum teridentifikasi"
    : "query provider gagal; kode error resmi belum tersedia";
  if (format === "JSON") {
    // Read a bounded error envelope; never expose arbitrary error/message/body values.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > 65536) break;
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
    }
    let data: Record<string, unknown> = {};
    try {
      const value: unknown = length <= 65536 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) data = value as Record<string, unknown>;
    } catch { /* Malformed JSON is still an HTTP failure, not a parser diagnosis. */ }
    const reasons: Record<string, string> = {
      tier_required: "tier akun tidak memenuhi akses endpoint/parameter",
      demo_key_endpoint_not_allowed: "demo key tidak diizinkan untuk endpoint ini",
      origin_not_allowed: "origin request tidak diizinkan oleh pengaturan key",
      origin_required: "key mensyaratkan origin; periksa pengaturan key untuk penggunaan server",
      auth_backend_unavailable: "layanan autentikasi sementara tidak tersedia; bukan bukti key salah",
      rate_limit_exceeded: "kuota/rate limit tercapai",
      statement_timeout: "query provider sementara timeout",
      concurrency: "batas query bersamaan tercapai",
      capacity: "kapasitas query provider sementara penuh"
    };
    const code = [data.code, data.error, data.error_kind].find((v): v is string =>
      typeof v === "string" && Object.hasOwn(reasons, v));
    if (code) { details.code = code; reason = reasons[code]; }
    else if (data.error === "Invalid or revoked API key") { details.code = "invalid_or_revoked_key"; reason = "key tidak valid atau sudah dicabut"; }
    else if (response.status === 401) reason = "autentikasi key gagal";
    const tiers = new Set(["BASIC", "PRO", "ULTRA", "BUSINESS", "ENTERPRISE"]);
    if (typeof data.your_tier === "string" && tiers.has(data.your_tier)) details.yourTier = data.your_tier;
    if (typeof data.required_tier === "string" && tiers.has(data.required_tier)) details.requiredTier = data.required_tier;
  } else await response.body?.cancel().catch(() => undefined);
  if (details.code) reason += ` (${details.code})`;
  if (details.yourTier || details.requiredTier) reason += `; tier ${details.yourTier ?? "?"}, diperlukan ${details.requiredTier ?? "?"}`;
  if (details.requestId) reason += `; request ID ${details.requestId}`;
  return { reason: `HTTP ${response.status}: ${reason}. Jenis respons: ${format}.`, details };
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
  private blockedError?: ProviderHttpError;
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
    if (Date.now() < this.blockedUntil) throw this.blockedError
      ?? new ProviderHttpError(this.name, `cooldown setelah HTTP ${this.blockedStatus}.`, this.blockedStatus);
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
        if ([401, 402, 403, 429].includes(response.status) || (this.name === "MadeOnSol" && response.status === 503)) {
          const header = response.headers.get("retry-after");
          const reset = this.name === "MadeOnSol" && response.status === 429 ? response.headers.get("x-ratelimit-reset") : null;
          const retry = header !== null ? Number(header) : reset !== null ? Number(reset) - Date.now() / 1000 : 300;
          const minimum = this.name === "MadeOnSol" ? 1 : 60;
          const maximum = reset !== null && header === null ? 86400 : 3600;
          this.blockedUntil = Date.now() + Math.min(maximum, Math.max(minimum, Number.isFinite(retry) ? retry : 300)) * 1000;
          this.blockedStatus = response.status;
        }
        if (this.name === "MadeOnSol") {
          const secrets = Object.values(this.headers).map((value) => value.replace(/^Bearer\s+/i, ""));
          const failure = await madeOnSolFailure(response, secrets);
          const error = new ProviderHttpError(this.name, failure.reason, response.status, failure.details);
          if ([401, 402, 403, 429, 503].includes(response.status)) this.blockedError = error;
          throw error;
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
