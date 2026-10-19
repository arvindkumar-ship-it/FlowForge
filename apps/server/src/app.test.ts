import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { publicIPv4, hashPassword, verifyPassword, safeHttp } from "./security";
import type { Graph } from "../../../packages/core/src/model";
const graph: Graph = {
  nodes: [
    {
      id: "start",
      type: "manual",
      name: "Manual trigger",
      parameters: {},
      position: { x: 0, y: 0 },
    },
    {
      id: "set",
      type: "set",
      name: "Map fields",
      parameters: { fields: { message: "Hello" } },
      position: { x: 260, y: 0 },
    },
  ],
  edges: [{ id: "e", source: "start", target: "set" }],
};
const open: Awaited<ReturnType<typeof createApp>>[] = [];
async function fixture() {
  const f = await createApp({
    databasePath: ":memory:",
    vaultKey: "ab".repeat(32),
    origin: "http://localhost:5173",
    worker: false,
  });
  open.push(f);
  const setup = await f.app.inject({
    method: "POST",
    url: "/api/auth/setup",
    payload: {
      name: "Owner",
      email: "owner@example.com",
      password: "long-password-123",
    },
  });
  expect(setup.statusCode).toBe(200);
  const headers = {
    cookie: setup.headers["set-cookie"]!.toString().split(";")[0]!,
  };
  const saved = await f.app.inject({
    method: "POST",
    url: "/api/workflows",
    headers,
    payload: { name: "Test workflow", graph },
  });
  expect(saved.statusCode).toBe(201);
  return { ...f, headers, workflow: saved.json() };
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((f) => f.app.close()));
});
describe("API security and durability", () => {
  it("rejects invalid worker and admission settings before opening storage", async () => {
    for (const settings of [
      { concurrency: 0 },
      { concurrency: Number.NaN },
      { concurrency: 65 },
      { highWater: 0 },
    ]) {
      await expect(
        createApp({
          databasePath: ":memory:",
          vaultKey: "ab".repeat(32),
          origin: "http://localhost:5173",
          ...settings,
        }),
      ).rejects.toThrow();
    }
  });
  it("does not count normal wait resumes toward the crash retry budget", async () => {
    const f = await fixture();
    const job = f.store.enqueue(f.workflow, [{}], "manual");
    for (let i = 0; i < 5; i++) {
      const claimed = f.store.claim()!;
      expect(claimed.attempts).toBe(1);
      f.store.finish(claimed, "waiting", 0);
    }
    const run = f.store.claim()!;
    f.store.db.prepare("UPDATE runs SET lease_until=0 WHERE id=?").run(job.id);
    expect(f.store.claim()!.attempts).toBe(2);
    f.store.db.prepare("UPDATE runs SET lease_until=0 WHERE id=?").run(job.id);
    expect(f.store.claim()!.attempts).toBe(3);
    f.store.db.prepare("UPDATE runs SET lease_until=0 WHERE id=?").run(job.id);
    expect(f.store.claim()).toBeUndefined();
    expect(
      f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(run.id)!
        .status,
    ).toBe("crashed");
  });
  it("rejects missing key, unauthorized access and cross-origin writes", async () => {
    await expect(
      createApp({ databasePath: ":memory:", vaultKey: "", origin: "x" }),
    ).rejects.toThrow("VAULT_KEY");
    const f = await fixture();
    expect((await f.app.inject("/api/workflows")).statusCode).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflows",
          headers: { ...f.headers, origin: "https://evil.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/setup",
          payload: { email: "b@example.com", password: "long-password-123" },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("enqueues once and pins workflow revision", async () => {
    const f = await fixture();
    const request = {
      method: "POST" as const,
      url: `/api/workflows/${f.workflow.id}/run`,
      headers: { ...f.headers, "idempotency-key": "one" },
      payload: { input: [{ x: 1 }] },
    };
    const first = await f.app.inject(request);
    const second = await f.app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().duplicate).toBe(true);
    const changed = structuredClone(graph);
    changed.nodes[1]!.parameters = { fields: { message: "Changed" } };
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: `/api/workflows/${f.workflow.id}`,
          headers: f.headers,
          payload: { name: "New", version: 1, graph: changed },
        })
      ).statusCode,
    ).toBe(200);
    f.tick();
    await expect
      .poll(
        async () =>
          (
            await f.app.inject({
              url: `/api/executions/${first.json().id}`,
              headers: f.headers,
            })
          ).json().status,
      )
      .toBe("success");
    const run = (
      await f.app.inject({
        url: `/api/executions/${first.json().id}`,
        headers: f.headers,
      })
    ).json();
    expect(run.version).toBe(1);
    expect(JSON.parse(run.snapshot).outputs.set[0].message).toBe("Hello");
    expect(
      f.store.db.prepare("SELECT count(*) AS n FROM outbox").get()!.n,
    ).toBeGreaterThanOrEqual(3);
  });
  it("detects save conflicts, invalid graph and missing IDs", async () => {
    const f = await fixture();
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: `/api/workflows/${f.workflow.id}`,
          headers: f.headers,
          payload: { name: "Bad", version: 99, graph },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflows",
          headers: f.headers,
          payload: { name: "Bad", graph: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          url: "/api/workflows/missing",
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(404);
  });
  it("enforces project isolation and viewer permissions", async () => {
    const f = await fixture();
    f.store.db.prepare("INSERT INTO projects VALUES('other','Other')").run();
    const foreign = f.store.saveWorkflow("other", "test", "Private", graph);
    expect(
      (
        await f.app.inject({
          url: `/api/workflows/${foreign.id}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(404);
    const user = await f.app.inject({
      method: "POST",
      url: "/api/users",
      headers: f.headers,
      payload: {
        name: "Viewer",
        email: "viewer@example.com",
        password: "long-password-123",
        role: "viewer",
      },
    });
    expect(user.statusCode).toBe(200);
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "viewer@example.com", password: "long-password-123" },
    });
    const headers = {
      cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
    };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflows",
          headers,
          payload: { name: "Forbidden", graph },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await f.app.inject({ url: "/api/audit", headers })).statusCode,
    ).toBe(403);
  });
  it("encrypts credentials and never returns envelopes or secrets", async () => {
    const f = await fixture();
    const secret = "do-not-leak-this";
    const r = await f.app.inject({
      method: "POST",
      url: "/api/credentials",
      headers: f.headers,
      payload: { name: "API", host: "example.com", secret },
    });
    expect(r.statusCode).toBe(201);
    const list = await f.app.inject({
      url: "/api/credentials",
      headers: f.headers,
    });
    expect(list.body).not.toContain(secret);
    expect(list.body).not.toContain("envelope");
    expect(
      JSON.stringify(f.store.db.prepare("SELECT * FROM credentials").get()),
    ).not.toContain(secret);
  });
  it("resumes wait jobs and rejects stale lease checkpoints", async () => {
    const f = await fixture();
    const g = structuredClone(graph);
    g.nodes[1]!.type = "wait";
    g.nodes[1]!.parameters = { seconds: 0 };
    const w = f.store.saveWorkflow("default", "owner", "Wait", g);
    const job = f.store.enqueue(w, [{}], "manual");
    f.tick();
    await expect
      .poll(
        () =>
          f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(job.id)!
            .status,
      )
      .toBe("waiting");
    f.tick();
    await expect
      .poll(
        () =>
          f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(job.id)!
            .status,
      )
      .toBe("success");
    f.store.enqueue(w, [{}], "manual");
    const claimed = f.store.claim()!;
    f.store.db
      .prepare("UPDATE runs SET lease_until=0 WHERE id=?")
      .run(claimed.id);
    const replacement = f.store.claim()!;
    expect(replacement.lease).not.toBe(claimed.lease);
    expect(() =>
      f.store.checkpoint(claimed, { cursor: 0, traces: [], outputs: {} }),
    ).toThrow("lease");
  });
  it("sheds overload and cancels queued work", async () => {
    const f = await fixture();
    expect(() =>
      f.store.enqueue(f.workflow, [{}], "manual", undefined, 0),
    ).toThrow("Queue");
    const job = f.store.enqueue(f.workflow, [{}], "manual");
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/executions/${job.id}/cancel`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(f.store.claim()).toBeUndefined();
  });
  it("only dispatches active webhooks", async () => {
    const f = await fixture();
    const g = structuredClone(graph);
    g.nodes[0]!.type = "webhook";
    const w = f.store.saveWorkflow("default", "owner", "Hook", g);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/webhooks/${w.id}`,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/api/workflows/${w.id}/active`,
          headers: f.headers,
          payload: { active: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/webhooks/${w.id}`,
          payload: { message: "event" },
        })
      ).statusCode,
    ).toBe(202);
  });
});
describe("network and password guards", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "0.0.0.0",
    "192.0.0.1",
    "203.0.113.1",
  ])("blocks %s", (ip) => expect(publicIPv4(ip)).toBe(false));
  it("allows public addresses and verifies salted passwords", async () => {
    expect(publicIPv4("8.8.8.8")).toBe(true);
    const hash = await hashPassword("pass");
    expect(await verifyPassword("pass", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("rejects invalid protocols, credentials and private requests", async () => {
    for (const url of [
      "bad",
      "file:///etc/passwd",
      "http://user:pass@example.com",
      "http://example.com:8080",
      "http://127.0.0.1",
    ])
      await expect(
        safeHttp({ url }, new AbortController().signal, "key"),
      ).rejects.toThrow();
  });
});
