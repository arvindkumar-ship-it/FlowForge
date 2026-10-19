# ADR 0001: deterministic single-instance foundation

The supplied master spec is the product target. Its companion Blueprint and phase prompts were not supplied. Start with a real vertical slice, not simulated integrations or an embedded automation engine.

TypeScript, Fastify, React and React Flow provide transport and UI primitives. Original code owns graph validation, deterministic traversal, expressions, durable job claims, wait snapshots, version pinning, vault and authorization. SQLite WAL with synchronous FULL is the explicitly single-host Tier S store. Atomic state/outbox writes and lease fencing are prerequisites for additional adapters.

Do not run multiple hosts against a network filesystem. Tier L requires PostgreSQL, independent Redis queues, object storage and measured failure/load gates before deployment; none of those capacities are claimed by this implementation. External effects are at-least-once after a crash. Operators must use downstream idempotency keys.

Expressions use an Acorn AST allowlist compiled to closures, with no dynamic code execution or ambient globals. Arbitrary code nodes are excluded until an isolated task runner exists. HTTP requests resolve and pin public IP addresses, refuse redirects, limit response bytes and enforce deadlines.

Dependencies use permissive licenses; the lockfile is authoritative. Node SQLite is experimental in Node 22; this release pins that runtime family. Authentication uses Node scrypt (memory-hard, configured parameters) pending an argon2id migration. No production compliance or high-availability claim is made.
