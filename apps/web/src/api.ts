export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  project_id: string;
};
export type Workflow = {
  id: string;
  name: string;
  active: number;
  version: number;
  graph: string;
  updated_at: number;
  project_id: string;
};
export type Run = {
  id: string;
  workflow_id: string;
  workflow_name?: string;
  status: string;
  mode: string;
  version: number;
  created_at: number;
  finished_at: number | null;
  error: string | null;
  snapshot?: string;
  graph?: string;
  input?: string;
};
export type Credential = {
  id: string;
  name: string;
  type: string;
  host: string;
  updated_at: number;
};
/** Same-origin, cookie-authenticated transport with problem detail errors. */
export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method ?? "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20_000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("FlowForge is temporarily unavailable. Please retry.");
  }
  if (!response.ok)
    throw new Error(data.title ?? "Request failed. Please try again.");
  return data as T;
}
/** Human-readable timestamp with an absolute title on its parent. */
export const date = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
