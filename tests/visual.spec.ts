import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
test("owner setup, execution and responsive workspace audit", async ({
  page,
}) => {
  mkdirSync("artifacts/visual", { recursive: true });
  await page.goto("/");
  await page.locator(".auth-card").waitFor();
  if (await page.getByLabel("Your name", { exact: true }).isVisible()) {
    await page.getByLabel("Your name", { exact: true }).fill("Arvind Kumar");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("local-test@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("local-test-password-2026");
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
  } else if (
    await page.getByLabel("Email address", { exact: true }).isVisible()
  ) {
    await page
      .getByLabel("Email address", { exact: true })
      .fill("local-test@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("local-test-password-2026");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Workflows", exact: true }),
  ).toBeVisible();
  const serious: string[] = [];
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "Workflows",
      "Executions",
      "Credentials",
      "Insights",
      "Users",
      "Projects",
      "Settings",
    ]) {
      if (width < 1024)
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .getByRole("button", { name: route, exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: route, exact: true }),
      ).toBeVisible();
      await page.locator(".skeleton").first().waitFor({ state: "detached" });
      await page.screenshot({
        path: `artifacts/visual/${route.toLowerCase()}@${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const audit = await new AxeBuilder({ page }).analyze();
      serious.push(
        ...audit.violations
          .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
          .map(
            (v) =>
              `${route}@${width}: ${v.id} ${v.nodes.map((n) => n.target.join(",")).join(";")}`,
          ),
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Workflows", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .first()
    .click();
  await page.screenshot({ path: "artifacts/visual/create-dialog@1440.png" });
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill(`Customer onboarding ${Date.now()}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create workflow", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Execute workflow", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `artifacts/visual/editor@${width}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText("Map fields", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "artifacts/visual/node-details@1440.png" });
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .click();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("success", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "Hello from FlowForge",
  );
  await page.screenshot({
    path: "artifacts/visual/execution-success@1440.png",
  });
  expect(serious).toEqual([]);
});
