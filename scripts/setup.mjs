import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
if (!existsSync(".env")) {
  writeFileSync(
    ".env",
    `VAULT_KEY=${randomBytes(32).toString("hex")}\nDATABASE_PATH=data/flowforge.sqlite\nPUBLIC_ORIGIN=http://localhost:5173\nCOOKIE_SECURE=false\n`,
    { mode: 0o600, flag: "wx" },
  );
  process.stdout.write(
    "Created .env with a fresh local vault key. Back up this file securely.\n",
  );
} else
  process.stdout.write(
    ".env already exists; existing configuration preserved.\n",
  );
mkdirSync("data", { recursive: true });
mkdirSync("dist/web", { recursive: true });
