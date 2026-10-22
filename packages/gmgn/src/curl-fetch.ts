import { spawn } from "node:child_process";

// Credentials travel over stdin, never command-line arguments, temporary files, or logs.
export function createCurlFetcher(start: typeof spawn = spawn): typeof fetch {
  return async (input, init = {}) => {
    if (init.signal?.aborted) throw new DOMException("Recovery aborted", "AbortError");
    const url = new URL(String(input));
    if (url.protocol !== "https:" || url.username || url.password || (init.method && init.method !== "GET") || init.body) {
      throw new Error("Curl recovery requires an HTTPS GET.");
    }
    const headers = new Headers(init.headers);
    const lines = [`url = ${JSON.stringify(url.href)}`];
    headers.forEach((value, name) => {
      if (/[\r\n\x00]/.test(name + value)) throw new Error("Invalid recovery header.");
      lines.push(`header = ${JSON.stringify(`${name}: ${value}`)}`);
    });
    return new Promise<Response>((resolve, reject) => {
      const child = start("curl", ["--disable", "--silent", "--show-error", "--proto", "=https", "--max-time", "8",
        "--max-filesize", "4194304", "--config", "-", "--write-out", "\n%{http_code}\n%{content_type}"], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let bytes = 0;
      let done = false;
      const finish = (error?: Error, response?: Response) => {
        if (done) return;
        done = true; clearTimeout(timer); init.signal?.removeEventListener("abort", abort);
        if (error) { child.kill(); reject(error); } else resolve(response!);
      };
      const abort = () => { finish(new DOMException("Recovery aborted", "AbortError")); };
      const timer = setTimeout(abort, 9000);
      init.signal?.addEventListener("abort", abort, { once: true });
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        output += chunk;
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4 * 1024 * 1024 + 2048) finish(new Error("Curl response exceeded limit."));
      });
      child.stdout!.on("error", () => finish(new Error("Curl response pipe failed.")));
      child.stderr!.resume();
      child.stdin!.on("error", () => { finish(new Error("Curl request pipe failed.")); });
      child.on("error", () => finish(new Error("Curl recovery unavailable.")));
      child.on("close", (code) => {
        if (done) return;
        if (code !== 0) { finish(new Error(`Curl recovery failed (exit ${Number.isInteger(code) ? code : "unknown"}).`)); return; }
        try {
          const typeAt = output.lastIndexOf("\n");
          const statusAt = output.lastIndexOf("\n", typeAt - 1);
          const status = Number(output.slice(statusAt + 1, typeAt));
          if (statusAt < 0 || !Number.isInteger(status) || status < 200 || status > 599) throw new Error("Invalid curl status.");
          const body = output.slice(0, statusAt);
          const type = output.slice(typeAt + 1).trim();
          finish(undefined, new Response([204, 205, 304].includes(status) ? null : body, {
            status, headers: type ? { "content-type": type } : {}
          }));
        } catch { finish(new Error("Curl recovery returned an invalid response.")); }
      });
      if (init.signal?.aborted) abort();
      if (!done) child.stdin!.end(lines.join("\n") + "\n");
    });
  };
}

export const curlFetch = createCurlFetcher();
