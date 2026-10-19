import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync("apps/web/src/styles/tokens.css", "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[a-f0-9]{3,6})/gi)].map((m) => [
    m[1]!,
    m[2]!,
  ]),
);
function luminance(hex: string) {
  const normalized =
    hex.length === 4 ? "#" + [...hex.slice(1)].map((c) => c + c).join("") : hex;
  return [1, 3, 5]
    .map((i) => parseInt(normalized.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
}
it.each([
  ["--text", "--bg"],
  ["--text-2", "--surface-subtle"],
  ["--text-3", "--bg"],
  ["--surface", "--accent"],
  ["--success", "--success-soft"],
  ["--warning", "--warning-soft"],
  ["--danger", "--danger-soft"],
  ["--info", "--info-soft"],
  ["--text-2", "--surface-sunken"],
])("%s on %s meets WCAG AA for small text", (fg, bg) => {
  const [a, b] = [luminance(tokens[fg]!), luminance(tokens[bg]!)].sort(
    (a, b) => a - b,
  );
  expect((b! + 0.05) / (a! + 0.05)).toBeGreaterThanOrEqual(4.5);
});
