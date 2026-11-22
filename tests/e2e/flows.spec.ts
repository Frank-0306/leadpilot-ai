import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end flows against a running app + real Supabase project.
 * NOT run in the build environment (no browser access to Supabase there).
 *
 * Requires (see README → End-to-end tests):
 *   E2E_BASE_URL            e.g. http://localhost:3000
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 *   E2E_AGENT_EMAIL / E2E_AGENT_PASSWORD   (login linked to agent "Maya Thompson")
 */

const unique = Date.now().toString(36);
const lead = {
  name: `E2E Visitor ${unique}`,
  email: `e2e.${unique}@example.com`,
};

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe.configure({ mode: "serial" });

test("1. a visitor submits the public Northstar form", async ({ page }) => {
  await page.goto("/northstar");
  await page.getByLabel("Full name").fill(lead.name);
  await page.getByLabel("Email").fill(lead.email);
  await page.getByLabel("Home or area you're interested in").fill("3 bed in Lakeview");
  await page.getByLabel(/I agree/).check();
  await page.waitForTimeout(3_000); // the timing token rejects instant (bot-like) posts
  await page.getByRole("button", { name: "Send my request" }).click();
  await expect(page.getByText("Request received")).toBeVisible();
});

test("2–6. admin finds, assigns, moves the lead and manages a task", async ({ page }) => {
  await signIn(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  const before = Number(await page.getByRole("link", { name: /Total leads/ }).locator("span").nth(1).innerText());

  // 2. lead is in the CRM as Website / New Lead
  await page.goto(`/leads?q=${encodeURIComponent(lead.email)}`);
  await page.getByRole("link", { name: lead.name }).click();
  await expect(page.getByText("New Lead").first()).toBeVisible();
  await expect(page.getByText("Website").first()).toBeVisible();

  // 4. assign to Maya
  await page.getByLabel("Responsible agent").selectOption({ label: "Maya Thompson" });
  await expect(page.getByText("Lead assigned.")).toBeVisible();

  // 3. stage change (same server action as the Kanban move)
  await page.getByLabel("Stage").selectOption({ label: "Contacted" });
  await expect(page.getByText("Moved to Contacted.")).toBeVisible();

  // 5. create and complete a task
  await page.getByPlaceholder(/Add a task/).fill("E2E follow-up call");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task created.")).toBeVisible();
  await page.getByRole("checkbox", { name: /Complete “E2E follow-up call”/ }).check();
  await expect(page.getByText("Task completed.")).toBeVisible();

  // 8. persists after reload
  await page.reload();
  await expect(page.getByLabel("Stage")).toHaveValue("contacted");
  await expect(page.getByLabel("Responsible agent")).toHaveText(/Maya Thompson/);

  // 6. indicators reflect the new lead
  await page.goto("/dashboard");
  const after = Number(await page.getByRole("link", { name: /Total leads/ }).locator("span").nth(1).innerText());
  expect(after).toBeGreaterThanOrEqual(before);

  // Kanban drag and drop to Qualified
  await page.goto("/pipeline");
  const card = page.getByRole("listitem").filter({ hasText: lead.name });
  await card.dragTo(page.getByRole("region", { name: /^Qualified/ }));
  await expect(page.getByText(`${lead.name} moved to Qualified.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /^Qualified/ }).getByText(lead.name)).toBeVisible();
});

test("7. an agent only sees their own records and no admin areas", async ({ page }) => {
  await signIn(page, process.env.E2E_AGENT_EMAIL!, process.env.E2E_AGENT_PASSWORD!);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page).toHaveURL(/denied=1/);

  // The lead assigned to Maya is visible, without a delete button…
  await page.goto(`/leads?q=${encodeURIComponent(lead.email)}`);
  await page.getByRole("link", { name: lead.name }).click();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByLabel("Responsible agent")).toBeDisabled();

  // …but a teammate's lead is not.
  await page.goto("/leads?q=ethan.morales%40example.com");
  await expect(page.getByText("No leads match these filters")).toBeVisible();
});
