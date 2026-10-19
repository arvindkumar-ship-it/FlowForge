# Dependency choices

The lockfile records exact versions; no automation product code or icons were copied.

| Building block                                 | Purpose                                                             | Declared license                      |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Fastify and official plugins                   | HTTP, cookies, security headers, rate limits, static files          | MIT                                   |
| React / React DOM                              | UI primitives                                                       | MIT                                   |
| React Flow                                     | Canvas interaction primitives only                                  | MIT                                   |
| Zod                                            | Input schemas                                                       | MIT                                   |
| Acorn                                          | Parse expressions into an AST; our allowlist compiler executes them | MIT                                   |
| Undici                                         | Bounded outgoing HTTP transport                                     | MIT                                   |
| Lucide                                         | One coherent navigation/action icon set                             | ISC                                   |
| Inter / Geist Mono via Fontsource              | Self-hosted UI/code fonts                                           | SIL OFL-1.1                           |
| TypeScript, Vite, tsx                          | Compilation and runtime tooling                                     | Apache-2.0 / MIT                      |
| Vitest, Playwright, axe-core, ESLint, Prettier | Verification and formatting                                         | MIT / Apache-2.0 / MPL-2.0 (axe-core) |

The allowed license gate accepts permissive licenses and MPL-2.0 for the test-only accessibility analyzer, with no GPL dependency in the delivered runtime. Keep upstream license notices when redistributing. Run `npm audit --audit-level=moderate`; advisories can change after the recorded verification date.
