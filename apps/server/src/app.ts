import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { Store, type Workflow, type Run } from "./store";
import { hashPassword, verifyPassword, tokenHash, safeHttp } from "./security";
import {
  FlowError,
  validateGraph,
  type Item,
} from "../../../packages/core/src/model";
import { Vault } from "../../../packages/core/src/vault";
import { execute } from "../../../packages/core/src/engine";
type User = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  project_id: string;
};
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}
const authSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  name: z.string().min(1).max(80).optional(),
});
const workflowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  graph: z.unknown(),
  version: z.number().int().positive().optional(),
});
const credentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/),
  secret: z.string().min(1).max(8192),
});
export type AppOptions = {
  databasePath: string;
  vaultKey: string;
  origin: string;
  secureCookies?: boolean;
  worker?: boolean;
  concurrency?: number;
  highWater?: number;
  logger?: boolean;
};
/** Construct API, storage and the original durable worker runtime. */
export async function createApp(options: AppOptions) {
  const vault = new Vault(options.vaultKey);
  const store = new Store(options.databasePath);
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
        }
      : false,
    bodyLimit: 512 * 1024,
    requestTimeout: 30_000,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.decorateRequest("user", null);
  const requireWrite = (user: User | null) => {
    if (!user || user.role === "viewer")
      throw new FlowError("FORBIDDEN", "Editor access required", 403);
  };
  const requireOwner = (user: User | null) => {
    if (user?.role !== "owner")
      throw new FlowError("FORBIDDEN", "Owner access required", 403);
  };
  app.addHook("onRequest", async (req, reply) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== options.origin
    )
      throw new FlowError("CSRF", "Request origin is not allowed", 403);
    const token = req.cookies.ff_session;
    if (token) {
      req.user =
        (store.db
          .prepare(
            "SELECT u.id,u.email,u.name,u.role,u.project_id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?",
          )
          .get(tokenHash(token), Date.now()) as User | undefined) ?? null;
    }
    const path = req.url.split("?")[0]!;
    if (
      path.startsWith("/api/") &&
      !["/api/auth/status", "/api/auth/setup", "/api/auth/login"].includes(
        path,
      ) &&
      !req.user
    ) {
      reply.header("Cache-Control", "no-store");
      throw new FlowError("UNAUTHORIZED", "Sign in to continue", 401);
    }
    if (path.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler<Error & { statusCode?: number; code?: string }>(
    (error, req, reply) => {
      const status =
        error instanceof FlowError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : (error.statusCode ?? 500);
      if (status >= 500 && !(error instanceof FlowError))
        req.log.error(
          { err: { name: error.name, code: error.code } },
          "Request failed",
        );
      if (status === 503) reply.header("Retry-After", "5");
      reply
        .status(status)
        .type("application/problem+json")
        .send({
          type: "about:blank",
          title:
            status >= 500 && !(error instanceof FlowError)
              ? "Internal server error"
              : error instanceof z.ZodError
                ? "Invalid request"
                : error.message,
          status,
          code: error instanceof FlowError ? error.code : "REQUEST_ERROR",
          ...(error instanceof z.ZodError
            ? {
                errors: error.issues.map((i) => ({
                  path: i.path.join("."),
                  message: i.message,
                })),
              }
            : {}),
        });
    },
  );
  const issueSession = (id: string, reply: import("fastify").FastifyReply) => {
    const token = randomBytes(32).toString("hex");
    store.db
      .prepare("DELETE FROM sessions WHERE expires_at < ?")
      .run(Date.now());
    store.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(tokenHash(token), id, Date.now() + 86400_000);
    reply.setCookie("ff_session", token, {
      httpOnly: true,
      secure: options.secureCookies ?? false,
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
  };
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    store.db.prepare("SELECT 1").get();
    return { status: "ready", storage: "sqlite-single-host" };
  });
  app.get("/api/auth/status", async (req) => ({
    setupRequired: !store.db.prepare("SELECT id FROM users LIMIT 1").get(),
    user: req.user,
  }));
  app.post(
    "/api/auth/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const data = authSchema.parse(req.body);
      const password = await hashPassword(data.password);
      const id = randomUUID();
      store.transaction(() => {
        if (store.db.prepare("SELECT id FROM users LIMIT 1").get())
          throw new FlowError(
            "SETUP_CLOSED",
            "Owner has already been configured",
            409,
          );
        store.db
          .prepare("INSERT INTO users VALUES(?,?,?,?,'owner','default')")
          .run(
            id,
            data.email.toLowerCase(),
            data.name ?? "Workspace owner",
            password,
          );
        store.audit(id, "owner.setup", id);
      });
      issueSession(id, reply);
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const data = authSchema.parse(req.body);
      const row = store.db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(data.email.toLowerCase()) as
        (User & { password: string }) | undefined;
      const valid = await verifyPassword(
        data.password,
        row?.password ?? `00000000000000000000000000000000:${"0".repeat(128)}`,
      );
      if (!row || !valid)
        throw new FlowError(
          "LOGIN_FAILED",
          "Email or password is incorrect",
          401,
        );
      if (req.cookies.ff_session)
        store.db
          .prepare("DELETE FROM sessions WHERE token=?")
          .run(tokenHash(req.cookies.ff_session));
      issueSession(row.id, reply);
      store.audit(row.id, "session.login", row.id);
      return { ok: true };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.ff_session)
      store.db
        .prepare("DELETE FROM sessions WHERE token=?")
        .run(tokenHash(req.cookies.ff_session));
    reply.clearCookie("ff_session", { path: "/" });
    return { ok: true };
  });
  const findWorkflow = (id: string, project: string) => {
    const w = store.db
      .prepare(
        "SELECT * FROM workflows WHERE id=? AND project_id=? AND archived=0",
      )
      .get(id, project) as Workflow | undefined;
    if (!w) throw new FlowError("NOT_FOUND", "Workflow not found", 404);
    return w;
  };
  app.get("/api/workflows", async (req) =>
    store.db
      .prepare(
        "SELECT * FROM workflows WHERE project_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 500",
      )
      .all(req.user!.project_id),
  );
  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (req) =>
    findWorkflow(req.params.id, req.user!.project_id),
  );
  app.post("/api/workflows", async (req, reply) => {
    requireWrite(req.user);
    const data = workflowSchema.parse(req.body);
    const { graph } = validateGraph(data.graph);
    reply.status(201);
    return store.saveWorkflow(
      req.user!.project_id,
      req.user!.id,
      data.name,
      graph,
    );
  });
  app.put<{ Params: { id: string } }>("/api/workflows/:id", async (req) => {
    requireWrite(req.user);
    findWorkflow(req.params.id, req.user!.project_id);
    const data = workflowSchema.parse(req.body);
    const { graph } = validateGraph(data.graph);
    return store.saveWorkflow(
      req.user!.project_id,
      req.user!.id,
      data.name,
      graph,
      req.params.id,
      data.version,
    );
  });
  app.patch<{ Params: { id: string } }>(
    "/api/workflows/:id/active",
    async (req) => {
      requireWrite(req.user);
      const w = findWorkflow(req.params.id, req.user!.project_id);
      const data = z.object({ active: z.boolean() }).parse(req.body);
      if (
        data.active &&
        !JSON.parse(w.graph).nodes.some(
          (n: { type: string }) => n.type === "webhook",
        )
      )
        throw new FlowError(
          "MANUAL_ONLY",
          "Manual workflows run on demand. Add a webhook trigger to activate.",
        );
      store.transaction(() => {
        store.db
          .prepare("UPDATE workflows SET active=?,updated_at=? WHERE id=?")
          .run(Number(data.active), Date.now(), w.id);
        store.audit(req.user!.id, "workflow.activation", w.id);
      });
      return { active: data.active };
    },
  );
  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (req) => {
    requireWrite(req.user);
    const w = findWorkflow(req.params.id, req.user!.project_id);
    store.transaction(() => {
      store.db
        .prepare("UPDATE workflows SET archived=1,active=0 WHERE id=?")
        .run(w.id);
      store.audit(req.user!.id, "workflow.archive", w.id);
    });
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>(
    "/api/workflows/:id/versions",
    async (req) => {
      findWorkflow(req.params.id, req.user!.project_id);
      return store.db
        .prepare(
          "SELECT version,created_at,graph FROM versions WHERE workflow_id=? ORDER BY version DESC LIMIT 100",
        )
        .all(req.params.id);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workflows/:id/run",
    async (req, reply) => {
      requireWrite(req.user);
      const w = findWorkflow(req.params.id, req.user!.project_id);
      const body = z
        .object({
          input: z
            .array(z.record(z.string(), z.unknown()))
            .max(10000)
            .default([{}]),
        })
        .parse(req.body ?? {});
      reply.status(202);
      return store.enqueue(
        w,
        body.input,
        "manual",
        z.string().max(200).optional().parse(req.headers["idempotency-key"]),
        options.highWater,
      );
    },
  );
  app.post<{ Params: { id: string } }>("/webhooks/:id", async (req, reply) => {
    const w = store.db
      .prepare("SELECT * FROM workflows WHERE id=? AND active=1 AND archived=0")
      .get(req.params.id) as Workflow | undefined;
    if (!w) throw new FlowError("NOT_FOUND", "Webhook not found", 404);
    // Webhooks are intentionally public capability URLs; do not put secret data in paths.
    reply.status(202);
    return store.enqueue(
      w,
      [{ body: req.body ?? {}, query: req.query }],
      "webhook",
      z.string().max(200).optional().parse(req.headers["idempotency-key"]),
      options.highWater,
    );
  });
  app.get("/api/executions", async (req) =>
    store.db
      .prepare(
        "SELECT r.id,r.workflow_id,r.status,r.mode,r.version,r.created_at,r.finished_at,r.error,w.name AS workflow_name FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE r.project_id=? ORDER BY r.created_at DESC LIMIT 200",
      )
      .all(req.user!.project_id),
  );
  app.get<{ Params: { id: string } }>("/api/executions/:id", async (req) => {
    const row = store.db
      .prepare("SELECT * FROM runs WHERE id=? AND project_id=?")
      .get(req.params.id, req.user!.project_id) as Run | undefined;
    if (!row) throw new FlowError("NOT_FOUND", "Execution not found", 404);
    return { ...row, lease: undefined };
  });
  const controllers = new Map<string, AbortController>();
  app.post<{ Params: { id: string } }>(
    "/api/executions/:id/cancel",
    async (req) => {
      requireWrite(req.user);
      const row = store.db
        .prepare("SELECT id FROM runs WHERE id=? AND project_id=?")
        .get(req.params.id, req.user!.project_id);
      if (!row) throw new FlowError("NOT_FOUND", "Execution not found", 404);
      store.transaction(() => {
        const r = store.db
          .prepare(
            "UPDATE runs SET status='canceled',finished_at=?,lease=NULL WHERE id=? AND status IN ('queued','running','waiting')",
          )
          .run(Date.now(), req.params.id);
        if (r.changes)
          store.db
            .prepare(
              "INSERT INTO outbox(run_id,status,created_at) VALUES(?,?,?)",
            )
            .run(req.params.id, "canceled", Date.now());
        store.audit(req.user!.id, "execution.cancel", req.params.id);
      });
      controllers.get(req.params.id)?.abort();
      return { ok: true };
    },
  );
  app.get("/api/credentials", async (req) =>
    store.db
      .prepare(
        "SELECT id,name,type,host,updated_at FROM credentials WHERE project_id=? ORDER BY updated_at DESC",
      )
      .all(req.user!.project_id),
  );
  app.post("/api/credentials", async (req, reply) => {
    requireWrite(req.user);
    const data = credentialSchema.parse(req.body);
    const id = randomUUID();
    store.transaction(() => {
      store.db
        .prepare("INSERT INTO credentials VALUES(?,?,?,?,?,?,?)")
        .run(
          id,
          data.name,
          req.user!.project_id,
          "httpBearer",
          data.host.toLowerCase(),
          vault.encrypt(id, data.secret),
          Date.now(),
        );
      store.audit(req.user!.id, "credential.create", id);
    });
    reply.status(201);
    return { id };
  });
  app.delete<{ Params: { id: string } }>(
    "/api/credentials/:id",
    async (req) => {
      requireWrite(req.user);
      const r = store.db
        .prepare("DELETE FROM credentials WHERE id=? AND project_id=?")
        .run(req.params.id, req.user!.project_id);
      if (!r.changes)
        throw new FlowError("NOT_FOUND", "Credential not found", 404);
      store.audit(req.user!.id, "credential.delete", req.params.id);
      return { ok: true };
    },
  );
  app.get("/api/users", async (req) => {
    requireOwner(req.user);
    return store.db
      .prepare("SELECT id,name,email,role FROM users WHERE project_id=?")
      .all(req.user!.project_id);
  });
  app.post("/api/users", async (req) => {
    requireOwner(req.user);
    const data = authSchema
      .extend({ role: z.enum(["editor", "viewer"]) })
      .parse(req.body);
    const password = await hashPassword(data.password);
    const id = randomUUID();
    if (
      store.db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(data.email.toLowerCase())
    )
      throw new FlowError("DUPLICATE_EMAIL", "Email already exists", 409);
    store.transaction(() => {
      store.db
        .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
        .run(
          id,
          data.email.toLowerCase(),
          data.name ?? data.email,
          password,
          data.role,
          req.user!.project_id,
        );
      store.audit(req.user!.id, "user.create", id);
    });
    return { id };
  });
  app.get("/api/projects", async (req) =>
    store.db
      .prepare("SELECT id,name FROM projects WHERE id=?")
      .all(req.user!.project_id),
  );
  app.get("/api/audit", async (req) => {
    requireOwner(req.user);
    return store.db
      .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
      .all();
  });
  app.get("/api/insights", async (req) => {
    const rows = store.db
      .prepare(
        "SELECT status,count(*) AS count,avg(finished_at-created_at) AS duration FROM runs WHERE project_id=? AND created_at>? GROUP BY status",
      )
      .all(req.user!.project_id, Date.now() - 7 * 86400_000);
    const daily = store.db
      .prepare(
        "SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') AS day,count(*) AS count FROM runs WHERE project_id=? AND created_at>? GROUP BY day ORDER BY day",
      )
      .all(req.user!.project_id, Date.now() - 7 * 86400_000);
    return { rows, daily };
  });
  let closing = false;
  const tasks = new Set<Promise<void>>();
  const runOne = async (run: Run) => {
    const controller = new AbortController();
    controllers.set(run.id, controller);
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const result = await execute(JSON.parse(run.graph), {
        id: run.id,
        input: JSON.parse(run.input) as Item[],
        signal: controller.signal,
        snapshot: run.snapshot ? JSON.parse(run.snapshot) : undefined,
        checkpoint: (snapshot) => store.checkpoint(run, snapshot),
        http: async (p, signal, key) => {
          let secret: string | undefined;
          if (p.credentialId) {
            const row = store.db
              .prepare(
                "SELECT id,host,envelope FROM credentials WHERE id=? AND project_id=?",
              )
              .get(String(p.credentialId), run.project_id) as
              { id: string; host: string; envelope: string } | undefined;
            if (
              !row ||
              new URL(String(p.url)).hostname.toLowerCase() !== row.host
            )
              throw new FlowError(
                "CREDENTIAL_SCOPE",
                "Credential is unavailable for this destination",
              );
            secret = vault.decrypt(row.id, row.envelope);
          }
          return safeHttp(p, signal, key, secret);
        },
      });
      store.finish(run, result.status, result.waitUntil);
    } catch (e) {
      store.finish(
        run,
        "error",
        0,
        e instanceof FlowError
          ? e.message
          : controller.signal.aborted
            ? "Execution canceled or timed out"
            : "Node execution failed",
      );
    } finally {
      clearTimeout(timer);
      controllers.delete(run.id);
    }
  };
  const tick = () => {
    if (closing) return;
    try {
      while (tasks.size < (options.concurrency ?? 4)) {
        const run = store.claim();
        if (!run) break;
        const task = runOne(run);
        tasks.add(task);
        void task
          .finally(() => tasks.delete(task))
          .catch((e) =>
            app.log.error(
              { name: e instanceof Error ? e.name : "Error" },
              "Worker failed",
            ),
          );
      }
    } catch (e) {
      app.log.error(
        { name: e instanceof Error ? e.name : "Error" },
        "Queue consumption paused",
      );
    }
  };
  const interval =
    options.worker === false ? undefined : setInterval(tick, 100);
  const web = resolve("dist/web");
  if (existsSync(web)) {
    await app.register(staticFiles, { root: web, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") || req.url.startsWith("/webhooks/")
        ? reply.status(404).send({ title: "Not found", status: 404 })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    closing = true;
    clearInterval(interval);
    for (const c of controllers.values()) c.abort();
    await Promise.allSettled(tasks);
    store.db.close();
  });
  return { app, store, tick };
}
