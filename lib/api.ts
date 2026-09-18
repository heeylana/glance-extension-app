/**
 * Backend client. Used by the side panel directly (it holds the Privy token)
 * and by the background worker on behalf of content scripts.
 */
import { BACKEND_URL } from "./config";
import type { ApiError } from "./api-types";

export type TokenGetter = () => Promise<{ accessToken: string | null }>;

export class ApiClient {
  constructor(private getToken: TokenGetter, private base = BACKEND_URL) {}

  private async headers(): Promise<Record<string, string>> {
    const { accessToken } = await this.getToken();
    const h: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
    if (accessToken) h.authorization = `Bearer ${accessToken}`;
    return h;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T | ApiError> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: await this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { ok: false, code: "OFFLINE", message: "Glance is offline right now. Your money is safe in your account." };
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { ok: false, code: "BAD_RESPONSE", message: "That didn't go through — nothing was spent. Try again?" };
    }
    if (!res.ok && typeof json === "object" && json && !("code" in json)) {
      return { ok: false, code: `HTTP_${res.status}`, message: "That didn't go through — nothing was spent. Try again?" };
    }
    return json as T | ApiError;
  }

  /** Binary POST (audio). Errors come back as the backend's JSON error, or a generic one. */
  async postBytes(path: string, body: unknown): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | ApiError> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { method: "POST", headers: await this.headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch {
      return { ok: false, code: "OFFLINE", message: "Glance is offline right now. Your money is safe in your account." };
    }
    if (!res.ok) {
      const text = await res.text();
      try {
        const json = JSON.parse(text) as ApiError;
        if (json && json.ok === false) return json;
      } catch {
        /* not json */
      }
      return { ok: false, code: `HTTP_${res.status}`, message: "That didn't go through — nothing was spent. Try again?" };
    }
    return { ok: true, bytes: await res.arrayBuffer(), mime: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  delete<T>(path: string) {
    return this.request<T>("DELETE", path);
  }
}

export function isApiError(x: unknown): x is ApiError {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}
