import { existsSync, readFileSync } from "node:fs";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "OFL-1.1",
]);
const rejected = [];
let inspected = 0;
let optionalSkipped = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  if (!existsSync(`${path}/package.json`)) {
    if (entry.optional) {
      optionalSkipped++;
      continue;
    }
    rejected.push(`${path}: not installed`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
  inspected++;
  if (!allowed.has(pkg.license) && !(entry.dev && pkg.license === "MPL-2.0"))
    rejected.push(`${pkg.name}: ${pkg.license ?? "missing license"}`);
}
if (rejected.length) {
  process.stderr.write(
    `License policy requires review:\n${rejected.join("\n")}\n`,
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    `License policy passed: ${inspected} installed packages; ${optionalSkipped} platform-optional packages skipped.\n`,
  );
