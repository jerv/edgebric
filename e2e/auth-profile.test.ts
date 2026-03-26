import { test, expect } from "@playwright/test";

/**
 * Auth & Profile — E2E tests.
 *
 * Covers: solo mode authentication, auth/me response shape,
 * profile updates, notification preferences, org listing,
 * provider detection, devices endpoint, logout.
 *
 * Runs in solo mode (AUTH_MODE=none) — auto-admin.
 */

test.describe("Solo Mode Authentication", () => {
  test("/api/auth/me returns full solo user profile", async ({ request }) => {
    const res = await request.get("/api/auth/me");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    // Core identity
    expect(body.authMode).toBe("none");
    expect(body.isAdmin).toBe(true);
    expect(body.email).toBe("solo@localhost");
    expect(body.queryToken).toBe("solo-user");

    // Solo mode specific
    expect(body.orgId).toBe("solo");
    expect(body.onboardingComplete).toBe(true);
    expect(body.vaultModeEnabled).toBe(true);
  });

  test("provider endpoint returns 'none' in solo mode", async ({ request }) => {
    const res = await request.get("/api/auth/provider");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.provider).toBe("none");
    expect(body.providerName).toBeTruthy();
  });

  test("devices endpoint returns empty array", async ({ request }) => {
    const res = await request.get("/api/auth/devices");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

test.describe("Profile Management", () => {
  test("updates user profile name", async ({ request }) => {
    const res = await request.put("/api/auth/profile", {
      data: {
        firstName: "TestFirst",
        lastName: "TestLast",
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe("TestFirst TestLast");
  });

  test("profile update with first name only", async ({ request }) => {
    const res = await request.put("/api/auth/profile", {
      data: { firstName: "SoloUser" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("SoloUser");
  });

  test("profile update rejects empty first name", async ({ request }) => {
    const res = await request.put("/api/auth/profile", {
      data: { firstName: "" },
    });
    expect(res.status()).toBe(400);
  });

  test("profile update rejects overly long name", async ({ request }) => {
    const res = await request.put("/api/auth/profile", {
      data: { firstName: "a".repeat(101) },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Notification Preferences", () => {
  test("updates notification level to 'mentions'", async ({ request }) => {
    const res = await request.put("/api/auth/notification-prefs", {
      data: { defaultGroupChatNotifLevel: "mentions" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.defaultGroupChatNotifLevel).toBe("mentions");
  });

  test("updates notification level to 'none'", async ({ request }) => {
    const res = await request.put("/api/auth/notification-prefs", {
      data: { defaultGroupChatNotifLevel: "none" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.defaultGroupChatNotifLevel).toBe("none");
  });

  test("updates notification level to 'all'", async ({ request }) => {
    const res = await request.put("/api/auth/notification-prefs", {
      data: { defaultGroupChatNotifLevel: "all" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.defaultGroupChatNotifLevel).toBe("all");
  });

  test("rejects invalid notification level", async ({ request }) => {
    const res = await request.put("/api/auth/notification-prefs", {
      data: { defaultGroupChatNotifLevel: "invalid" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Organization Management", () => {
  test("lists orgs in solo mode", async ({ request }) => {
    const res = await request.get("/api/auth/orgs");
    expect(res.ok()).toBe(true);
    const orgs = await res.json();
    expect(Array.isArray(orgs)).toBe(true);
    // Solo mode should have at least one org
  });
});

test.describe("Logout", () => {
  test("logout endpoint succeeds", async ({ request }) => {
    const res = await request.post("/api/auth/logout");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("auth/me still works after logout (solo mode re-authenticates)", async ({ request }) => {
    // In solo mode, ensureSoloSession auto-populates on every request
    const res = await request.get("/api/auth/me");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.email).toBe("solo@localhost");
  });
});
