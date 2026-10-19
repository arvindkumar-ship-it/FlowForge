import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
  agentOptions: undefined as unknown,
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) {
      mocks.agentOptions = options;
    }
    close = mocks.close;
  },
  request: mocks.request,
}));
import { safeHttp } from "./security";
function response(statusCode: number, text: string) {
  return {
    statusCode,
    body: {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(text);
      },
      destroy: vi.fn(),
    },
  };
}
afterEach(() => {
  vi.resetAllMocks();
});
describe("HTTP isolation", () => {
  it("pins a public DNS result and redacts a reflected token", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.request.mockResolvedValue(response(200, '{"token":"secret-value"}'));
    const output = await safeHttp(
      { url: "https://example.com", method: "POST", body: { x: 1 } },
      new AbortController().signal,
      "stable-key",
      "secret-value",
    );
    expect(output).toEqual({ statusCode: 200, body: { token: "[REDACTED]" } });
    const agent = mocks.agentOptions as {
      connect: {
        lookup: (
          h: string,
          o: object,
          cb: (e: unknown, a: unknown) => void,
        ) => void;
      };
    };
    const cb = vi.fn();
    agent.connect.lookup("rebound.example", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    expect(mocks.request.mock.calls[0]![1].headers["idempotency-key"]).toBe(
      "stable-key",
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("refuses mixed public/private records and empty DNS answers", async () => {
    for (const addresses of [
      [],
      [{ address: "8.8.8.8" }, { address: "10.0.0.1" }],
    ]) {
      mocks.lookup.mockResolvedValue(addresses);
      await expect(
        safeHttp(
          { url: "https://example.com" },
          new AbortController().signal,
          "key",
        ),
      ).rejects.toThrow("forbidden");
    }
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("refuses redirects, server errors, invalid methods and large responses", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    for (const status of [301, 500]) {
      mocks.request.mockResolvedValue(response(status, ""));
      await expect(
        safeHttp(
          { url: "https://example.com" },
          new AbortController().signal,
          "key",
        ),
      ).rejects.toThrow(`HTTP ${status}`);
    }
    mocks.request.mockResolvedValue(response(200, "x".repeat(1024 * 1024 + 1)));
    await expect(
      safeHttp(
        { url: "https://example.com" },
        new AbortController().signal,
        "key",
      ),
    ).rejects.toThrow("1 MiB");
    await expect(
      safeHttp(
        { url: "https://example.com", method: "CONNECT" },
        new AbortController().signal,
        "key",
      ),
    ).rejects.toThrow("method");
  });
  it("requires TLS for credentials and preserves plain text without secrets", async () => {
    await expect(
      safeHttp(
        { url: "http://example.com" },
        new AbortController().signal,
        "key",
        "secret",
      ),
    ).rejects.toThrow("HTTPS");
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.request.mockResolvedValue(response(200, "hello"));
    expect(
      await safeHttp(
        { url: "https://example.com" },
        new AbortController().signal,
        "key",
      ),
    ).toEqual({ statusCode: 200, body: "hello" });
  });
});
