import { test, expect } from "@playwright/test";

/**
 * Smoke tests — verify the app boots, auth works, and core pages render.
 * Runs in solo mode (AUTH_MODE=none) so no OIDC is needed.
 */

/** Wait for React to finish rendering (past loading state). */
async function waitForApp(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("root");
    return root && root.innerHTML.length > 100 && !root.innerHTML.includes("Loading");
  }, { timeout: 15_000 });
}

test.describe("App boot & solo mode auth", () => {
  test("loads the app and auto-authenticates", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    // If we get past loading, the app rendered successfully
    await expect(page.locator("#root")).not.toBeEmpty();
  });

  test("API health check returns healthy", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  test("/api/auth/me returns solo user", async ({ request }) => {
    const res = await request.get("/api/auth/me");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.authMode).toBe("none");
    expect(body.isAdmin).toBe(true);
    expect(body.email).toBe("solo@localhost");
  });
});

test.describe("Navigation", () => {
  test("sidebar renders with expected links", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    // Sidebar should have Data Sources link (solo user is admin)
    // .first() because both desktop + mobile sidebars render the link
    await expect(page.locator('a[href="/library"]').first()).toBeVisible({ timeout: 5_000 });

    // Account link should be present (href includes ?tab=general search param)
    await expect(page.locator('a[href^="/account"]').first()).toBeVisible({ timeout: 5_000 });

    // Organization link should be hidden in solo mode
    await expect(page.locator('a[href="/organization"]')).toHaveCount(0);
  });

  test("navigates to Data Sources page", async ({ page }) => {
    await page.goto("/library");
    await waitForApp(page);

    await expect(
      page.getByText("Network Source")
        .or(page.getByText("New Source"))
        .or(page.getByText("Data Sources"))
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("navigates to Account page", async ({ page }) => {
    await page.goto("/account");
    await waitForApp(page);

    await expect(
      page.getByText("Account")
        .or(page.getByText("Profile"))
        .or(page.getByText("Appearance"))
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Static pages", () => {
  test("privacy page loads", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible({ timeout: 10_000 });
  });

  test("terms page loads", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible({ timeout: 10_000 });
  });

  test("acknowledgments page loads", async ({ page }) => {
    await page.goto("/acknowledgments");
    await expect(
      page.getByText("Acknowledgments")
        .or(page.getByText("Open Source"))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Chat interface", () => {
  test("chat page renders (empty state or input)", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    // With no documents uploaded, the app shows "No sources yet" empty state
    // instead of a textarea. Both states are valid.
    await expect(
      page.locator("textarea").first()
        .or(page.getByText("No sources yet"))
        .or(page.getByText("Chat unavailable"))
    ).toBeVisible({ timeout: 5_000 });
  });
});
