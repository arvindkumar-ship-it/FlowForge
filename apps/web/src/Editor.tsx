import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Play,
  Plus,
  Save,
  Workflow as WorkflowIcon,
  Globe,
  Braces,
  Filter,
  Timer,
  GitMerge,
  CircleAlert,
  History,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { api, type Workflow, type Credential, type Run } from "./api";
import { Alert, Button, Dialog } from "./ui";
import { ExecutionDetail } from "./App";
import {
  nodeTypes as kinds,
  type Graph,
  type Snapshot,
} from "../../../packages/core/src/model";
const definitions = {
  manual: {
    label: "Manual trigger",
    subtitle: "Start from the editor",
    icon: Play,
    defaults: {},
  },
  webhook: {
    label: "Webhook trigger",
    subtitle: "Receive an HTTP event",
    icon: Globe,
    defaults: {},
  },
  set: {
    label: "Map fields",
    subtitle: "Create or transform data",
    icon: Braces,
    defaults: {
      fields: { message: "Hello from FlowForge", total: "=$json.amount * 2" },
      keepInput: true,
    },
  },
  filter: {
    label: "Filter",
    subtitle: "Keep matching items",
    icon: Filter,
    defaults: { condition: "=$json.total > 10" },
  },
  http: {
    label: "HTTP request",
    subtitle: "Call a public API",
    icon: Globe,
    defaults: { url: "https://example.com", method: "GET" },
  },
  wait: {
    label: "Wait",
    subtitle: "Persist and resume later",
    icon: Timer,
    defaults: { seconds: 5 },
  },
  merge: {
    label: "Merge",
    subtitle: "Append connected inputs",
    icon: GitMerge,
    defaults: {},
  },
  fail: {
    label: "Fail",
    subtitle: "Stop with an error",
    icon: CircleAlert,
    defaults: {},
  },
};
/** A runnable starting workflow; data comes from the execution input. */
export function initialGraph(): Graph {
  return {
    nodes: [
      {
        id: "trigger",
        type: "manual",
        name: "Manual trigger",
        parameters: {},
        position: { x: 100, y: 180 },
      },
      {
        id: "map",
        type: "set",
        name: "Map fields",
        parameters: {
          fields: { message: "Hello from FlowForge" },
          keepInput: true,
        },
        position: { x: 430, y: 180 },
      },
    ],
    edges: [{ id: "trigger-map", source: "trigger", target: "map" }],
  };
}
type CanvasNode = Node<{
  name: string;
  kind: Graph["nodes"][number]["type"];
  parameters: Record<string, unknown>;
  status?: string;
  items?: number;
}>;
function WorkflowNode({ data, selected }: NodeProps<CanvasNode>) {
  const def = definitions[data.kind];
  const Icon = def.icon;
  return (
    <div
      className={`workflow-node ${selected ? "node-selected" : ""} ${data.status ?? ""}`}
    >
      {!["manual", "webhook"].includes(data.kind) && (
        <Handle type="target" position={Position.Left} />
      )}
      <span className="node-tile">
        <Icon size={20} strokeWidth={1.5} />
      </span>
      <div>
        <strong>{data.name}</strong>
        <small>{def.subtitle}</small>
      </div>
      <Handle type="source" position={Position.Right} />
      {data.items !== undefined && (
        <span className="node-count">{data.items} items</span>
      )}
    </div>
  );
}
const nodeTypes = { workflow: WorkflowNode };
function toNodes(g: Graph): CanvasNode[] {
  return g.nodes.map((n) => ({
    id: n.id,
    type: "workflow",
    position: n.position,
    data: { name: n.name, kind: n.type, parameters: n.parameters },
  }));
}
export function Editor(props: {
  workflow: Workflow;
  onBack: () => void;
  notify: (s: string) => void;
  readOnly: boolean;
}) {
  return (
    <ReactFlowProvider>
      <EditorContent {...props} />
    </ReactFlowProvider>
  );
}
function EditorContent({
  workflow,
  onBack,
  notify,
  readOnly: roleReadOnly,
}: {
  workflow: Workflow;
  onBack: () => void;
  notify: (s: string) => void;
  readOnly: boolean;
}) {
  const [mobileReadOnly, setMobileReadOnly] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobileReadOnly(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const readOnly = roleReadOnly || mobileReadOnly;
  const flow = useReactFlow();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const resize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flow.fitView({ padding: 0.2, maxZoom: 1 });
      }, 100);
    };
    window.addEventListener("resize", resize);
    resize();
    return () => {
      window.removeEventListener("resize", resize);
      clearTimeout(timer);
    };
  }, [flow]);
  const [nodes, setNodes] = useState<CanvasNode[]>(() =>
    toNodes(JSON.parse(workflow.graph)),
  );
  const [edges, setEdges] = useState<Edge[]>(
    () => JSON.parse(workflow.graph).edges,
  );
  const [name, setName] = useState(workflow.name);
  const [version, setVersion] = useState(workflow.version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(Boolean(workflow.active));
  const [add, setAdd] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [run, setRun] = useState<Run>();
  const [inputOpen, setInputOpen] = useState(false);
  const [input, setInput] = useState('[\n  { "amount": 25 }\n]');
  const [history, setHistory] =
    useState<{ version: number; created_at: number; graph: string }[]>();
  const [deleteNode, setDeleteNode] = useState<string>();
  const [jsonError, setJsonError] = useState("");
  const graph = (): Graph => ({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      name: n.data.name,
      position: n.position,
      parameters: n.data.parameters,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  });
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const changedNodes = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (readOnly) return;
      setNodes((n) => applyNodeChanges(changes, n));
      if (changes.some((c) => c.type !== "select" && c.type !== "dimensions"))
        setDirty(true);
    },
    [readOnly],
  );
  const changedEdges = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      setEdges((e) => applyEdgeChanges(changes, e));
      if (changes.some((c) => c.type !== "select")) setDirty(true);
    },
    [readOnly],
  );
  const connect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      setEdges((e) => addEdge({ ...connection, id: crypto.randomUUID() }, e));
      setDirty(true);
    },
    [readOnly],
  );
  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const saved = await api<Workflow>(`/workflows/${workflow.id}`, {
        method: "PUT",
        body: { name, version, graph: graph() },
      });
      setVersion(saved.version);
      setDirty(false);
      notify(`Version ${saved.version} saved`);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const execute = async () => {
    try {
      const items = JSON.parse(input);
      if (
        !Array.isArray(items) ||
        items.some((i) => !i || typeof i !== "object" || Array.isArray(i))
      )
        throw new Error("Input must be a JSON array of objects");
      if (dirty && !(await save())) return;
      const result = await api<{ id: string }>(
        `/workflows/${workflow.id}/run`,
        { method: "POST", body: { input: items } },
      );
      setInputOpen(false);
      setRun({
        id: result.id,
        workflow_id: workflow.id,
        status: "queued",
        created_at: Date.now(),
        finished_at: null,
        error: null,
        mode: "manual",
        version,
      });
      notify("Execution queued");
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };
  const focus = nodes.find((n) => n.id === selected);
  return (
    <div className="editor">
      <header className="editor-toolbar">
        <Button
          variant="tertiary"
          aria-label="Back to workflows"
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Leave this workflow and discard unsaved changes?")
            )
              onBack();
          }}
        >
          <ArrowLeft size={18} />
        </Button>
        <input
          className="workflow-name"
          aria-label="Workflow name"
          value={name}
          readOnly={readOnly}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          maxLength={100}
        />
        <span className="save-state">
          {saving
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : `Saved · v${version}`}
        </span>
        <div className="editor-toolbar-end">
          <Button
            aria-label="Version history"
            onClick={async () => {
              try {
                setHistory(await api(`/workflows/${workflow.id}/versions`));
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <History size={16} />
            <span>History</span>
          </Button>
          <label className="active-label">
            <input
              type="checkbox"
              role="switch"
              checked={active}
              disabled={readOnly}
              onChange={async (e) => {
                const next = e.target.checked;
                try {
                  await api(`/workflows/${workflow.id}/active`, {
                    method: "PATCH",
                    body: { active: next },
                  });
                  setActive(next);
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            />
            Active
          </label>
          {!readOnly && (
            <Button
              variant={dirty ? "primary" : "secondary"}
              onClick={save}
              loading={saving}
              disabled={!dirty}
            >
              <Save size={16} />
              Save
            </Button>
          )}
        </div>
      </header>
      <div className="editor-context">
        <WorkflowIcon size={16} />
        <span>Editor</span>
        <span className="context-separator">/</span>
        <span>Connect a trigger to the steps you want to run.</span>
        <span className="context-end">
          {nodes.length} nodes · {edges.length} connections
        </span>
      </div>
      <div className="canvas">
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={changedNodes}
          onEdgesChange={changedEdges}
          onConnect={connect}
          onNodeDoubleClick={(_e, n) => setSelected(n.id)}
          onNodeClick={(_e, n) => setSelected(n.id)}
          fitView
          minZoom={0.3}
          maxZoom={1.8}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          deleteKeyCode={null}
          onKeyDown={(e) => {
            if (e.key === "Delete" && !readOnly && !focus) {
              const n = nodes.find((n) => n.selected);
              if (n) setDeleteNode(n.id);
            }
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="var(--border-strong)"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
        {!readOnly && (
          <Button className="add-node-button" onClick={() => setAdd(true)}>
            <Plus size={18} />
            Add node
          </Button>
        )}
        <div className="canvas-hint">
          Click a node to edit · Drag a handle to connect
        </div>
        {!readOnly && (
          <div className="execute-bar">
            <Button
              variant="primary"
              onClick={() => {
                setJsonError("");
                setInputOpen(true);
              }}
            >
              <Play size={16} />
              Execute workflow
            </Button>
          </div>
        )}
        <div className="mobile-canvas-note">
          Open on desktop to edit. You can inspect workflow nodes here.
        </div>
      </div>
      {add && (
        <Dialog
          title="Add a step"
          description="Choose what happens next, then connect its input handle."
          onClose={() => setAdd(false)}
        >
          <div className="node-picker">
            {kinds.map((kind) => {
              const d = definitions[kind];
              return (
                <button
                  key={kind}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setNodes((n) => [
                      ...n,
                      {
                        id,
                        type: "workflow",
                        position: {
                          x: 150 + n.length * 160,
                          y: 100 + (n.length % 2) * 140,
                        },
                        data: {
                          name: d.label,
                          kind,
                          parameters: structuredClone(d.defaults),
                        },
                      },
                    ]);
                    setDirty(true);
                    setAdd(false);
                    setSelected(id);
                  }}
                >
                  <span className="node-tile">
                    <d.icon size={20} />
                  </span>
                  <div>
                    <strong>{d.label}</strong>
                    <small>{d.subtitle}</small>
                  </div>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
      {focus && (
        <NodeDetails
          key={focus.id}
          node={focus}
          workflowId={workflow.id}
          readOnly={readOnly}
          onClose={() => setSelected(undefined)}
          onDelete={() => {
            setSelected(undefined);
            setDeleteNode(focus.id);
          }}
          onSave={(title, parameters) => {
            setNodes((n) =>
              n.map((row) =>
                row.id === focus.id
                  ? { ...row, data: { ...row.data, name: title, parameters } }
                  : row,
              ),
            );
            setDirty(true);
            setSelected(undefined);
          }}
          notify={notify}
        />
      )}
      {inputOpen && (
        <Dialog
          title="Execute workflow"
          description="Supply trigger data as a JSON array. Each object is one item."
          onClose={() => setInputOpen(false)}
        >
          <label>
            Input data
            <textarea
              className="code-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={8}
              spellCheck={false}
            />
          </label>
          {jsonError && <Alert message={jsonError} />}
          <footer>
            <Button onClick={() => setInputOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={execute} loading={saving}>
              <Play size={16} />
              Run workflow
            </Button>
          </footer>
        </Dialog>
      )}
      {run && (
        <ExecutionDetail
          run={run}
          onClose={() => setRun(undefined)}
          notify={notify}
          readOnly={readOnly}
        />
      )}
      {history && (
        <Dialog
          title="Version history"
          description="Executions keep the version they started with."
          onClose={() => setHistory(undefined)}
        >
          <div className="version-list">
            {history.map((v) => (
              <div key={v.version}>
                <strong>Version {v.version}</strong>
                <span>{new Date(v.created_at).toLocaleString()}</span>
                {!readOnly && (
                  <Button
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          "Replace unsaved changes with this version?",
                        )
                      ) {
                        const g = JSON.parse(v.graph);
                        setNodes(toNodes(g));
                        setEdges(g.edges);
                        setDirty(true);
                        setHistory(undefined);
                      }
                    }}
                  >
                    Load into editor
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {deleteNode && (
        <Dialog
          title="Delete this node?"
          description="Its incoming and outgoing connections will also be removed."
          onClose={() => setDeleteNode(undefined)}
        >
          <footer>
            <Button onClick={() => setDeleteNode(undefined)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setNodes((n) => n.filter((row) => row.id !== deleteNode));
                setEdges((e) =>
                  e.filter(
                    (row) =>
                      row.source !== deleteNode && row.target !== deleteNode,
                  ),
                );
                setDirty(true);
                setDeleteNode(undefined);
              }}
            >
              Delete node
            </Button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
function NodeDetails({
  node,
  workflowId,
  readOnly,
  onClose,
  onSave,
  onDelete,
  notify,
}: {
  node: CanvasNode;
  workflowId: string;
  readOnly: boolean;
  onClose: () => void;
  onSave: (name: string, parameters: Record<string, unknown>) => void;
  onDelete: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(node.data.name);
  const [text, setText] = useState(
    JSON.stringify(node.data.parameters, null, 2),
  );
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tab, setTab] = useState("Parameters");
  useEffect(() => {
    api<Credential[]>("/credentials")
      .then(setCredentials)
      .catch((e) => notify(e.message));
    api<Run[]>("/executions")
      .then(setRuns)
      .catch((e) => notify(e.message));
  }, [notify]);
  const latest = runs.find(
    (r) => r.workflow_id === workflowId && r.status === "success",
  );
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => {
    if (latest)
      api<Run>(`/executions/${latest.id}`)
        .then((r) => {
          if (r.snapshot) setSnapshot(JSON.parse(r.snapshot));
        })
        .catch((e) => notify(e.message));
  }, [latest?.id, notify]);
  const d = definitions[node.data.kind];
  return (
    <Dialog title={d.label} description={d.subtitle} onClose={onClose} wide>
      <div className="node-details">
        <section>
          <h3>Input</h3>
          <p className="secondary">
            Expressions can read the current item through <code>$json</code>.
          </p>
          <pre>{'{\n  "amount": 25\n}'}</pre>
          <small>Example item. Actual input depends on connected nodes.</small>
          <h3>Expression examples</h3>
          <code>=$json.amount * 2</code>
          <br />
          <code>=$json.total &gt; 10</code>
          <br />
          <code>=$execution.id</code>
        </section>
        <section>
          <div className="tabs">
            {["Parameters", "Docs"].map((t) => (
              <button
                key={t}
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Docs" ? (
            <div className="node-docs">
              <p>
                {d.subtitle}. The workflow graph is validated before saving.
              </p>
              <p>
                Parameters beginning with <code>=</code> are expressions.
                Function calls, global objects and prototype access are
                forbidden.
              </p>
              {node.data.kind === "http" && (
                <p>
                  Public HTTP(S) only, ports 80/443. Redirects are refused.
                  Requests time out after 15 seconds; responses are limited to 1
                  MiB. Use credentialId for bearer auth.
                </p>
              )}
              {node.data.kind === "wait" && (
                <p>
                  The worker persists the cursor and resumes after the
                  configured seconds. Maximum wait: 30 days.
                </p>
              )}
              {node.data.kind === "filter" && (
                <p>
                  Only items for which condition evaluates to a truthy value
                  continue.
                </p>
              )}
            </div>
          ) : (
            <>
              <label>
                Node name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={readOnly}
                  maxLength={100}
                />
              </label>
              <label>
                Parameters · JSON
                <textarea
                  className="code-input"
                  rows={12}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  readOnly={readOnly}
                  spellCheck={false}
                />
              </label>
              {node.data.kind === "http" && (
                <label>
                  Credential
                  <select
                    aria-label="HTTP credential"
                    disabled={readOnly}
                    onChange={(e) => {
                      try {
                        const p = JSON.parse(text);
                        if (e.target.value) p.credentialId = e.target.value;
                        else delete p.credentialId;
                        setText(JSON.stringify(p, null, 2));
                      } catch {
                        setError("Fix the parameter JSON first");
                      }
                    }}
                  >
                    <option value="">No credential / choose credential</option>
                    {credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.host}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {node.data.kind === "webhook" && (
                <div className="inline-note">
                  <span>
                    Activate the workflow, then POST to{" "}
                    <code>/webhooks/{workflowId}</code>.
                  </span>
                </div>
              )}
              {error && <Alert message={error} />}
            </>
          )}
        </section>
        <section>
          <h3>Output</h3>
          <p className="secondary">Latest successful execution</p>
          <pre>
            {snapshot?.outputs[node.id]
              ? JSON.stringify(snapshot.outputs[node.id], null, 2)
              : "No output yet.\nExecute the workflow to inspect data."}
          </pre>
        </section>
      </div>
      <footer>
        {!readOnly && (
          <Button variant="danger" className="push-left" onClick={onDelete}>
            <Trash2 size={16} />
            Delete node
          </Button>
        )}
        <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button
            variant="primary"
            onClick={() => {
              try {
                const parameters = JSON.parse(text);
                if (
                  !parameters ||
                  typeof parameters !== "object" ||
                  Array.isArray(parameters) ||
                  !name.trim()
                )
                  throw new Error(
                    "Use a JSON object and a non-empty node name",
                  );
                onSave(name, parameters);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Apply changes
          </Button>
        )}
      </footer>
    </Dialog>
  );
}
