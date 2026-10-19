import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Workflow as WorkflowIcon,
  History,
  KeyRound,
  ChartNoAxesCombined,
  Users,
  FolderKanban,
  Settings,
  Search,
  Plus,
  ChevronDown,
  PanelLeftClose,
  ArrowUpRight,
  LogOut,
  Menu,
  X,
  Upload,
  ArrowRight,
  MoreHorizontal,
  Download,
  Trash2,
} from "lucide-react";
import {
  api,
  date,
  type Workflow,
  type Run,
  type User,
  type Credential,
} from "./api";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Empty,
  PageHeader,
  Skeleton,
} from "./ui";
import { Editor, initialGraph } from "./Editor";
import type { Graph } from "../../../packages/core/src/model";
type Page =
  | "Workflows"
  | "Executions"
  | "Credentials"
  | "Insights"
  | "Users"
  | "Projects"
  | "Settings";
const nav = [
  { name: "Workflows", icon: WorkflowIcon },
  { name: "Executions", icon: History },
  { name: "Credentials", icon: KeyRound },
  { name: "Insights", icon: ChartNoAxesCombined },
  { name: "Users", icon: Users },
  { name: "Projects", icon: FolderKanban },
  { name: "Settings", icon: Settings },
] as const;
export function App() {
  const [auth, setAuth] = useState<{
    setupRequired: boolean;
    user: User | null;
  }>();
  const [error, setError] = useState("");
  const [page, setPage] = useState<Page>(
    () =>
      nav.find(
        (n) => n.name.toLowerCase() === window.location.hash.replace("#/", ""),
      )?.name ?? "Workflows",
  );
  const [editing, setEditing] = useState<Workflow>();
  const [mobile, setMobile] = useState(false);
  const [command, setCommand] = useState(false);
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => {
    setToast(message);
  }, []);
  const loadAuth = useCallback(() => {
    api<{ setupRequired: boolean; user: User | null }>("/auth/status")
      .then(setAuth)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(loadAuth, [loadAuth]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const go = (p: Page) => {
    setEditing(undefined);
    setPage(p);
    setMobile(false);
    setCommand(false);
    history.replaceState(null, "", `/#/${p.toLowerCase()}`);
  };
  if (!auth)
    return (
      <main className="auth-page">
        {error ? <Alert message={error} retry={loadAuth} /> : <Skeleton />}
      </main>
    );
  if (!auth.user) return <Auth setup={auth.setupRequired} done={loadAuth} />;
  const user = auth.user;
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside
        className={`sidebar ${mobile ? "mobile-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="brand">
          <div className="brand-mark">
            <WorkflowIcon size={20} />
          </div>
          <span>FlowForge</span>
          <Button
            variant="tertiary"
            className="mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <div className="workspace">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Personal workspace</strong>
            <small>Self-hosted instance</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav>
          {nav.map((n, index) => (
            <div key={n.name}>
              {index === 4 && <div className="nav-label">Workspace</div>}
              {(n.name !== "Users" || user.role === "owner") && (
                <button
                  aria-label={n.name}
                  title={n.name}
                  className={`nav-item ${page === n.name ? "selected" : ""}`}
                  onClick={() => go(n.name)}
                >
                  <n.icon size={18} strokeWidth={1.5} />
                  <span>{n.name}</span>
                </button>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="instance-status">
            <span className="status-dot" /> Single-host instance
          </div>
          <div className="user-line">
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <Button
              variant="tertiary"
              aria-label="Sign out"
              onClick={() => {
                api("/auth/logout", { method: "POST" })
                  .then(loadAuth)
                  .catch((e) => notify(e.message));
              }}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="nav-backdrop" onClick={() => setMobile(false)} />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <Button
            variant="tertiary"
            className="mobile-only"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </Button>
          <PanelLeftClose className="desktop-only" size={17} />
          <span className="crumb">
            Personal workspace <span>/</span>{" "}
            <strong>{editing?.name ?? page}</strong>
          </span>
          <button
            aria-label="Go to… Ctrl K"
            className="global-search"
            onClick={() => setCommand(true)}
          >
            <Search size={16} />
            <span>Go to…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="topbar-end">
            FlowForge <span className="version">v0.1</span>
          </span>
        </header>
        <main id="main" className={editing ? "editor-main" : "content"}>
          {editing ? (
            <Editor
              workflow={editing}
              onBack={() => setEditing(undefined)}
              notify={notify}
              readOnly={user.role === "viewer"}
            />
          ) : page === "Workflows" ? (
            <Workflows
              onOpen={setEditing}
              notify={notify}
              readOnly={user.role === "viewer"}
            />
          ) : page === "Executions" ? (
            <Executions notify={notify} readOnly={user.role === "viewer"} />
          ) : page === "Credentials" ? (
            <Credentials notify={notify} readOnly={user.role === "viewer"} />
          ) : page === "Insights" ? (
            <Insights />
          ) : page === "Users" ? (
            <UserPage notify={notify} />
          ) : page === "Projects" ? (
            <Projects />
          ) : (
            <SettingsPage user={user} />
          )}
        </main>
      </div>
      {command && (
        <Dialog
          title="Go to a page"
          description="Choose a workspace destination."
          onClose={() => setCommand(false)}
        >
          <div className="command-items">
            {nav
              .filter((n) => n.name !== "Users" || user.role === "owner")
              .map((n) => (
                <button key={n.name} onClick={() => go(n.name)}>
                  <n.icon size={18} />
                  {n.name}
                  <ArrowRight size={16} />
                </button>
              ))}
          </div>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Auth({ setup, done }: { setup: boolean; done: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(`/auth/${setup ? "setup" : "login"}`, {
        method: "POST",
        body: Object.fromEntries(f),
      });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <WorkflowIcon size={22} />
          </span>
          FlowForge
        </div>
        <h1>{setup ? "Your workflows start here" : "Welcome back"}</h1>
        <p>
          {setup
            ? "Create the owner account for your FlowForge instance."
            : "Sign in to your workspace."}
        </p>
        <form onSubmit={submit}>
          {setup && (
            <label>
              Your name
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          <label>
            Email address
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              aria-label="Password"
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete={setup ? "new-password" : "current-password"}
              required
            />
            <small>At least 12 characters.</small>
          </label>
          {error && <Alert message={error} />}
          <Button variant="primary" loading={busy} type="submit">
            {setup ? "Create workspace" : "Sign in"}
            <ArrowRight size={16} />
          </Button>
        </form>
        <div className="auth-foot">
          Your instance. Your data. Your workflows.
        </div>
      </div>
    </main>
  );
}
function useResource<T>(path: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState("");
  const reload = useCallback(() => {
    api<T>(path)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
function Workflows({
  onOpen,
  notify,
  readOnly,
}: {
  onOpen: (w: Workflow) => void;
  notify: (s: string) => void;
  readOnly: boolean;
}) {
  const { data, error, reload } = useResource<Workflow[]>("/workflows");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Workflow>();
  const [menu, setMenu] = useState("");
  const save = async (name: string, graph: Graph) => {
    setBusy(true);
    try {
      const w = await api<Workflow>("/workflows", {
        method: "POST",
        body: { name, graph },
      });
      setCreate(false);
      onOpen(w);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const filtered = data?.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === "all" || Boolean(w.active) === (status === "active")),
  );
  const exportWorkflow = (w: Workflow) => {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ name: w.name, graph: JSON.parse(w.graph) }, null, 2)],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${w.name.replace(/[^a-z0-9]/gi, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Build, connect, and keep your work moving."
      >
        {!readOnly && (
          <>
            <label className="button secondary file-button">
              <Upload size={16} />
              Import
              <input
                type="file"
                accept="application/json"
                aria-label="Import workflow"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > 512 * 1024)
                      throw new Error("Import must be smaller than 512 KiB");
                    const d = JSON.parse(await f.text());
                    await save(d.name, d.graph);
                  } catch (err) {
                    notify((err as Error).message);
                  }
                }}
              />
            </label>
            <Button variant="primary" onClick={() => setCreate(true)}>
              <Plus size={16} />
              Create workflow
            </Button>
          </>
        )}
      </PageHeader>
      <div className="summary-strip">
        <span>
          <strong>{data?.length ?? "—"}</strong> workflows
        </span>
        <span>
          <span className="status-dot success-dot" />
          <strong>{data?.filter((w) => w.active).length ?? "—"}</strong> active
        </span>
        <span className="summary-end">Personal workspace</span>
      </div>
      <div className="filter-bar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search workflows"
            placeholder="Search workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Workflow status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="filter-meta">Last updated first</span>
      </div>
      {error ? (
        <Alert message={error} retry={reload} />
      ) : !data ? (
        <Skeleton />
      ) : !filtered?.length ? (
        <Empty
          title={
            search || status !== "all"
              ? "No matching workflows"
              : "Create your first workflow"
          }
          description={
            search || status !== "all"
              ? "Try another search or clear your filters."
              : "Start with a trigger, map your data, then connect the next step."
          }
          action={
            !readOnly && !search && status === "all" ? (
              <Button onClick={() => setCreate(true)}>
                Create workflow
                <ArrowRight size={16} />
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Project</th>
                <th>Status</th>
                <th>Last updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id}>
                  <td>
                    <button className="workflow-link" onClick={() => onOpen(w)}>
                      <span className="node-tile">
                        <WorkflowIcon size={18} />
                      </span>
                      <span>
                        <strong>{w.name}</strong>
                        <small>
                          {JSON.parse(w.graph).nodes.length} nodes · Version{" "}
                          {w.version}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td className="secondary-column">Personal</td>
                  <td>
                    <Badge status={w.active ? "active" : "inactive"} />
                  </td>
                  <td
                    className="secondary-column"
                    title={new Date(w.updated_at).toISOString()}
                  >
                    {date(w.updated_at)}
                  </td>
                  <td className="row-actions">
                    <Button
                      variant="tertiary"
                      aria-label={`Actions for ${w.name}`}
                      onClick={() => setMenu(menu === w.id ? "" : w.id)}
                    >
                      <MoreHorizontal size={18} />
                    </Button>
                    {menu === w.id && (
                      <div className="row-menu">
                        <button
                          onClick={() => {
                            exportWorkflow(w);
                            setMenu("");
                          }}
                        >
                          <Download size={16} />
                          Export JSON
                        </button>
                        {!readOnly && (
                          <button
                            className="danger-text"
                            onClick={() => {
                              setRemove(w);
                              setMenu("");
                            }}
                          >
                            <Trash2 size={16} />
                            Archive workflow
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="list-footer">
        <span>{filtered?.length ?? 0} workflows</span>
        <span>Changes are saved as immutable versions.</span>
      </div>
      {create && (
        <Dialog
          title="Create workflow"
          description="A manual trigger and a data mapping step are ready to connect."
          onClose={() => setCreate(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                String(new FormData(e.currentTarget).get("name")),
                initialGraph(),
              );
            }}
          >
            <label>
              Workflow name
              <input
                name="name"
                placeholder="e.g. Customer onboarding"
                autoFocus
                required
                maxLength={100}
              />
            </label>
            <footer>
              <Button onClick={() => setCreate(false)} type="button">
                Cancel
              </Button>
              <Button variant="primary" loading={busy}>
                Create workflow
              </Button>
            </footer>
          </form>
        </Dialog>
      )}
      {remove && (
        <Dialog
          title={`Archive ${remove.name}?`}
          description="New triggers will stop. Execution history and workflow versions are retained."
          onClose={() => setRemove(undefined)}
        >
          <footer>
            <Button onClick={() => setRemove(undefined)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api(`/workflows/${remove.id}`, { method: "DELETE" });
                  setRemove(undefined);
                  reload();
                  notify("Workflow archived");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Archive workflow
            </Button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
export function ExecutionDetail({
  run,
  onClose,
  notify,
  readOnly,
}: {
  run: Run;
  onClose: () => void;
  notify: (s: string) => void;
  readOnly: boolean;
}) {
  const { data, error, reload } = useResource<Run>(`/executions/${run.id}`);
  useEffect(() => {
    const t = setInterval(reload, 1500);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <Dialog
      title="Execution details"
      description={run.id}
      onClose={onClose}
      wide
    >
      {error ? (
        <Alert message={error} />
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <div className="detail-meta">
            <Badge status={data.status} />
            <span>Version {data.version}</span>
            <span>{date(data.created_at)}</span>
            {!readOnly &&
              ["queued", "running", "waiting"].includes(data.status) && (
                <Button
                  onClick={async () => {
                    try {
                      await api(`/executions/${run.id}/cancel`, {
                        method: "POST",
                      });
                      reload();
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Cancel execution
                </Button>
              )}
          </div>
          {data.error && <Alert message={data.error} />}
          <h3>Node results</h3>
          {data.snapshot ? (
            <pre>{JSON.stringify(JSON.parse(data.snapshot), null, 2)}</pre>
          ) : (
            <p>Waiting for the worker to start.</p>
          )}
        </>
      )}
    </Dialog>
  );
}
function Executions({
  notify,
  readOnly,
}: {
  notify: (s: string) => void;
  readOnly: boolean;
}) {
  const { data, error, reload } = useResource<Run[]>("/executions");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Run>();
  useEffect(() => {
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [reload]);
  const rows = data?.filter((r) => status === "all" || r.status === status);
  return (
    <>
      <PageHeader
        title="Executions"
        description="A clear record of every run, from trigger to result."
      />
      <div className="filter-bar">
        <select
          aria-label="Execution status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            "all",
            "success",
            "error",
            "running",
            "waiting",
            "queued",
            "canceled",
            "crashed",
          ].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <span className="live-label">
          <span className="status-dot success-dot" />
          Updates every 3 seconds
        </span>
      </div>
      {error ? (
        <Alert message={error} retry={reload} />
      ) : !data ? (
        <Skeleton />
      ) : !rows?.length ? (
        <Empty
          title="No executions yet"
          description="Run a workflow from the editor. Its progress and results will appear here."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Workflow</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Mode</th>
                <th>Execution</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="plain"
                      onClick={() => setSelected(r)}
                      aria-label={`${r.status} execution ${r.id}`}
                    >
                      <Badge status={r.status} />
                    </button>
                  </td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => setSelected(r)}
                    >
                      {r.workflow_name}
                    </button>
                  </td>
                  <td className="secondary-column">{date(r.created_at)}</td>
                  <td>
                    {r.finished_at ? `${r.finished_at - r.created_at} ms` : "—"}
                  </td>
                  <td className="secondary-column">{r.mode}</td>
                  <td className="mono secondary-column">{r.id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <ExecutionDetail
          run={selected}
          onClose={() => setSelected(undefined)}
          notify={notify}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
function Credentials({
  notify,
  readOnly,
}: {
  notify: (s: string) => void;
  readOnly: boolean;
}) {
  const { data, error, reload } = useResource<Credential[]>("/credentials");
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Credential>();
  return (
    <>
      <PageHeader
        title="Credentials"
        description="Encrypted connections, scoped to the hosts you trust."
      >
        {!readOnly && (
          <Button variant="primary" onClick={() => setAdd(true)}>
            <Plus size={16} />
            Add credential
          </Button>
        )}
      </PageHeader>
      <div className="inline-note">
        <KeyRound size={17} />
        <p>
          Secrets are encrypted at rest. Workflow nodes reference credentials by
          ID; secret values are never returned by the API.
        </p>
      </div>
      {error ? (
        <Alert message={error} retry={reload} />
      ) : !data ? (
        <Skeleton />
      ) : !data.length ? (
        <Empty
          title="Connect your first service"
          description="Add an HTTP bearer token, then select it in an HTTP request node."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Allowed host</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <small className="mono">{c.id}</small>
                  </td>
                  <td>HTTP bearer token</td>
                  <td>{c.host}</td>
                  <td className="secondary-column">{date(c.updated_at)}</td>
                  <td>
                    {!readOnly && (
                      <Button
                        variant="tertiary"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => setRemove(c)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {add && (
        <Dialog
          title="Add credential"
          description="The bearer token will only be sent to the exact allowed host."
          onClose={() => setAdd(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const body = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await api("/credentials", { method: "POST", body });
                setAdd(false);
                reload();
                notify("Credential encrypted and saved");
              } catch (err) {
                notify((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Name
              <input
                name="name"
                required
                autoFocus
                placeholder="Production API"
                maxLength={100}
              />
            </label>
            <label>
              Allowed host
              <input name="host" required placeholder="api.example.com" />
              <small>Exact hostname. No protocol, path or port.</small>
            </label>
            <label>
              Bearer token
              <input
                name="secret"
                type="password"
                autoComplete="off"
                required
              />
            </label>
            <footer>
              <Button type="button" onClick={() => setAdd(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy}>
                Save credential
              </Button>
            </footer>
          </form>
        </Dialog>
      )}
      {remove && (
        <Dialog
          title={`Delete ${remove.name}?`}
          description="Nodes using this credential will fail until another credential is selected."
          onClose={() => setRemove(undefined)}
        >
          <footer>
            <Button onClick={() => setRemove(undefined)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api(`/credentials/${remove.id}`, { method: "DELETE" });
                  setRemove(undefined);
                  reload();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Delete credential
            </Button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
function Insights() {
  const { data, error, reload } = useResource<{
    rows: { status: string; count: number; duration: number | null }[];
    daily: { day: string; count: number }[];
  }>("/insights");
  const total = data?.rows.reduce((a, r) => a + r.count, 0) ?? 0;
  const failed =
    data?.rows
      .filter((r) => ["error", "crashed"].includes(r.status))
      .reduce((a, r) => a + r.count, 0) ?? 0;
  const completed = data?.rows.filter((r) => r.duration !== null) ?? [];
  const finished = completed.reduce((a, r) => a + r.count, 0);
  const duration = finished
    ? completed.reduce((a, r) => a + r.duration! * r.count, 0) / finished
    : 0;
  return (
    <>
      <PageHeader
        title="Insights"
        description="Understand the work your workflows are doing."
      >
        <span className="period-label">Last 7 days · UTC</span>
      </PageHeader>
      {error ? (
        <Alert message={error} retry={reload} />
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <div className="metrics">
            {[
              ["Total executions", total],
              ["Failed executions", failed],
              [
                "Failure rate",
                `${total ? ((failed / total) * 100).toFixed(1) : "0"}%`,
              ],
              ["Average runtime", `${Math.round(duration)} ms`],
            ].map(([label, value]) => (
              <div key={label}>
                <p>{label}</p>
                <strong>{value}</strong>
                <small>Over the last 7 days</small>
              </div>
            ))}
          </div>
          <section className="chart-section">
            <div className="section-heading">
              <h2>Execution volume</h2>
              <span className="secondary">Daily runs</span>
            </div>
            {!data.daily.length ? (
              <Empty
                title="Your activity will appear here"
                description="Execute a workflow to start collecting operational metrics."
              />
            ) : (
              <div
                className="bar-chart"
                role="img"
                aria-label={data.daily
                  .map((d) => `${d.day}: ${d.count} runs`)
                  .join(", ")}
              >
                {data.daily.map((d) => (
                  <div key={d.day}>
                    <span>{d.count}</span>
                    <div
                      className="bar"
                      style={{
                        height: `${Math.max(4, (d.count / Math.max(...data.daily.map((r) => r.count))) * 160)}px`,
                      }}
                    />
                    <small>{d.day.slice(5)}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="chart-section">
            <h2>Execution outcomes</h2>
            {data.rows.map((r) => (
              <div className="setting-row" key={r.status}>
                <Badge status={r.status} />
                <strong>{r.count}</strong>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
function UserPage({ notify }: { notify: (s: string) => void }) {
  const { data, error, reload } = useResource<User[]>("/users");
  const [add, setAdd] = useState(false);
  return (
    <>
      <PageHeader
        title="Users"
        description="Give your team the access they need."
      >
        <Button variant="primary" onClick={() => setAdd(true)}>
          <Plus size={16} />
          Add user
        </Button>
      </PageHeader>
      {error ? (
        <Alert message={error} />
      ) : !data ? (
        <Skeleton />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <Badge status={u.role} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {add && (
        <Dialog
          title="Add workspace user"
          description="Share the initial password through your own secure channel."
          onClose={() => setAdd(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/users", {
                  method: "POST",
                  body: Object.fromEntries(new FormData(e.currentTarget)),
                });
                setAdd(false);
                reload();
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Email
              <input type="email" name="email" required />
            </label>
            <label>
              Initial password
              <input
                type="password"
                name="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Role
              <select name="role">
                <option value="editor">Editor — build and run workflows</option>
                <option value="viewer">
                  Viewer — inspect workflows and results
                </option>
              </select>
            </label>
            <footer>
              <Button type="button" onClick={() => setAdd(false)}>
                Cancel
              </Button>
              <Button variant="primary">Create user</Button>
            </footer>
          </form>
        </Dialog>
      )}
    </>
  );
}
function Projects() {
  const { data, error } =
    useResource<{ id: string; name: string }[]>("/projects");
  return (
    <>
      <PageHeader
        title="Projects"
        description="Your workflow and credential access boundary."
      />
      {error ? (
        <Alert message={error} />
      ) : !data ? (
        <Skeleton />
      ) : (
        data.map((p) => (
          <section className="project-row" key={p.id}>
            <span className="node-tile">
              <FolderKanban size={20} />
            </span>
            <div>
              <h2>{p.name}</h2>
              <p>Workflows, credentials and execution history</p>
            </div>
            <Badge status="workspace" />
          </section>
        ))
      )}
    </>
  );
}
function SettingsPage({ user }: { user: User }) {
  const [tab, setTab] = useState("Personal");
  const { data, error } = useResource<
    {
      id: number;
      actor: string;
      action: string;
      resource: string;
      created_at: number;
    }[]
  >(user.role === "owner" ? "/audit" : "/projects");
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your account and inspect workspace activity."
      />
      <div className="settings-layout">
        <nav aria-label="Settings sections">
          {[
            "Personal",
            "Security",
            ...(user.role === "owner" ? ["Audit log"] : []),
          ].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={tab === t ? "selected" : ""}
            >
              {t}
            </button>
          ))}
        </nav>
        <section>
          <h2>{tab}</h2>
          {tab === "Personal" ? (
            <>
              <div className="setting-row">
                <span>Name</span>
                <strong>{user.name}</strong>
              </div>
              <div className="setting-row">
                <span>Email</span>
                <strong>{user.email}</strong>
              </div>
              <div className="setting-row">
                <span>Workspace role</span>
                <Badge status={user.role} />
              </div>
            </>
          ) : tab === "Security" ? (
            <>
              <div className="setting-row">
                <span>Sessions</span>
                <span>HTTP-only · SameSite Strict · 24-hour expiry</span>
              </div>
              <div className="setting-row">
                <span>Credential encryption</span>
                <span>AES-256-GCM · Host-scoped bearer tokens</span>
              </div>
              <div className="setting-row">
                <span>Runtime</span>
                <span>Single host · SQLite WAL</span>
              </div>
              <p className="secondary">
                Use HTTPS and secure cookies before exposing this instance. MFA
                and SSO are not available in this release.
              </p>
            </>
          ) : error ? (
            <Alert message={error} />
          ) : !data ? (
            <Skeleton />
          ) : (
            <div className="audit-list">
              {data.map((a) => (
                <div key={a.id}>
                  <strong>{a.action}</strong>
                  <span className="mono">{a.resource}</span>
                  <small>{date(a.created_at)}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="docs-link">
        <ArrowUpRight size={16} />
        <span>
          Operational setup and deployment instructions are in the repository
          README.
        </span>
      </div>
    </>
  );
}
