import { QueryClient } from "@tanstack/react-query";

// The __PORT_5000__ placeholder is replaced by deploy_website at build time
// so API calls work both locally (relative /api/...) and in the hosted demo.
const API_BASE =
  typeof window !== "undefined" && (window as any).__API_BASE__
    ? (window as any).__API_BASE__
    : "";

// In-memory token for this session
let _token: string | null = null;

export function setAuthToken(token: string | null) {
  _token = token;
}
export function getAuthToken() {
  return _token;
}

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const [path] = queryKey as [string, ...unknown[]];
        const res = await apiRequest("GET", path);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? `Request failed: ${res.status}`);
        }
        return res.json();
      },
      staleTime: 30_000,
      retry: 1,
    },
  },
});
