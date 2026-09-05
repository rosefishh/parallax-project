// Centralized HTTP client for all backend requests.
// Uses VITE_API_URL from the environment; falls back to the dev proxy (/api)
// so the app works both in dev (proxied) and production (absolute URL).

export const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export type ApiSuccess<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export type ApiErrorBody = {
  success: boolean;
  message?: string;
  error?: string;
};

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody | null) {
    const message = body?.error || body?.message || `Request failed with status ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body ?? { success: false };
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, body as ApiErrorBody | null);
  }

  return body as T;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const query = params
    ? new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== "")
          .map(([key, value]) => [key, String(value)]),
      ).toString()
    : "";
  const url = `${API_BASE_URL}${path}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: data instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: data instanceof FormData ? data : JSON.stringify(data),
  });
  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  return parseResponse<T>(response);
}

export function apiBlobUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

// Resolves a backend-relative URL (e.g. /uploads/xxx.jpg) against the API origin
// so linked artifacts work in dev (vite proxy) and production (absolute VITE_API_URL).
export function resolveApiUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const origin = (() => {
    try {
      return new URL(API_BASE_URL).origin;
    } catch {
      // API_BASE_URL is relative (e.g. "/api" via the dev proxy) — resolve against
      // the page origin so the returned path is a working absolute URL.
      return typeof window !== "undefined" ? window.location.origin : "";
    }
  })();
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}