const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export class APIError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "APIError";
  }
}

// Callback for handling 401 errors
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedCallback(callback: () => void) {
  onUnauthorized = callback;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Handle 401 Unauthorized
    if (response.status === 401 && onUnauthorized) {
      onUnauthorized();
    }

    let errorMessage = `HTTP ${response.status} ${response.statusText || ""}`.trim();
    try {
      const text = await response.text();
      if (text) {
        try {
          const json = JSON.parse(text);
          if (json.error) {
            errorMessage = json.error;
          } else if (json.message) {
            errorMessage = json.message;
          }
        } catch {
          if (text.length < 200) {
            errorMessage = text;
          }
        }
      }
    } catch {
      // Keep default HTTP status message
    }

    throw new APIError(response.status, errorMessage);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  const body = await response.text();
  if (!body) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}

async function get<T>(endpoint: string): Promise<T> {
  return request<T>(endpoint, { method: "GET" });
}

async function post<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: "POST",
    body: data ? JSON.stringify(data) : undefined,
  });
}

async function patch<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: "PATCH",
    body: data ? JSON.stringify(data) : undefined,
  });
}

async function del<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: "DELETE",
    body: data ? JSON.stringify(data) : undefined,
  });
}

export const api = {
  get,
  post,
  patch,
  delete: del,
};
