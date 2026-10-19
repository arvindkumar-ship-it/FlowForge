import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { createApp } from "../apps/server/src/app";
const { app } = await createApp({
  databasePath: ":memory:",
  vaultKey: randomBytes(32).toString("hex"),
  origin: "http://localhost:3001",
  worker: false,
});
try {
  const html = await app.inject("/");
  assert.equal(html.statusCode, 200, "Build the web app before smoke testing");
  assert.match(html.headers["content-type"]!, /text\/html/);
  const assets = [
    ...html.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
  ].map((m) => m[1]!);
  assert(assets.length >= 2, "Compiled JS and CSS must exist");
  for (const asset of assets)
    assert.equal((await app.inject(asset)).statusCode, 200, asset);
  assert.equal((await app.inject("/api/workflows")).statusCode, 401);
  assert.equal((await app.inject("/health/ready")).statusCode, 200);
  process.stdout.write(
    `Production asset smoke passed: HTML, ${assets.length} assets, API boundary and readiness.\n`,
  );
} finally {
  await app.close();
}
