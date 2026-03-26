import { test, expect } from "@playwright/test";

/**
 * Org Admin — E2E tests.
 *
 * Covers: org details, org update, onboarding completion,
 * avatar upload/delete, member listing, invite, role change,
 * permissions update, member removal.
 *
 * Runs in solo mode (AUTH_MODE=none) — auto-admin as solo@localhost.
 */

test.describe("Org Details", () => {
  test("GET /api/admin/org returns org with expected shape", async ({ request }) => {
    const res = await request.get("/api/admin/org");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body.id).toBeTruthy();
    expect(body.name).toBeTruthy();
    expect(body.slug).toBeTruthy();
  });

  test("PUT /api/admin/org updates org name and reverts", async ({ request }) => {
    // Get current name
    const before = await (await request.get("/api/admin/org")).json();
    const originalName = before.name;

    // Update to a new name
    const updateRes = await request.put("/api/admin/org", {
      data: { name: "E2E Test Org" },
    });
    expect(updateRes.ok()).toBe(true);

    // Verify the change took effect
    const after = await (await request.get("/api/admin/org")).json();
    expect(after.name).toBe("E2E Test Org");

    // Revert to original name
    const revertRes = await request.put("/api/admin/org", {
      data: { name: originalName },
    });
    expect(revertRes.ok()).toBe(true);

    const reverted = await (await request.get("/api/admin/org")).json();
    expect(reverted.name).toBe(originalName);
  });
});

test.describe("Onboarding", () => {
  test("POST /api/admin/org/complete-onboarding succeeds", async ({ request }) => {
    const res = await request.post("/api/admin/org/complete-onboarding");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // Returns the updated org object with onboardingComplete in settings
    expect(body.id).toBeTruthy();
    expect(body.settings.onboardingComplete).toBe(true);
  });
});

test.describe("Org Avatar", () => {
  // Minimal valid 1x1 PNG (67 bytes)
  const PNG_BYTES = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  test("POST /api/admin/org/avatar uploads avatar", async ({ request }) => {
    const res = await request.post("/api/admin/org/avatar", {
      multipart: {
        avatar: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: PNG_BYTES,
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test("DELETE /api/admin/org/avatar removes avatar", async ({ request }) => {
    // Upload first so there's something to delete
    await request.post("/api/admin/org/avatar", {
      multipart: {
        avatar: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: PNG_BYTES,
        },
      },
    });

    const res = await request.delete("/api/admin/org/avatar");
    expect(res.ok()).toBe(true);
  });
});

test.describe("Members", () => {
  test("GET /api/admin/org/members includes solo user", async ({ request }) => {
    const res = await request.get("/api/admin/org/members");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    const soloUser = body.find((m: { email: string }) => m.email === "solo@localhost");
    expect(soloUser).toBeTruthy();
  });

  test("invite, update role, update permissions, and remove a member", async ({ request }) => {
    // 1. Invite a user
    const inviteRes = await request.post("/api/admin/org/members/invite", {
      data: { email: "invited@test.com" },
    });
    expect(inviteRes.ok()).toBe(true);

    // 2. Find the invited user's ID from the members list
    const membersRes = await request.get("/api/admin/org/members");
    expect(membersRes.ok()).toBe(true);
    const members = await membersRes.json();
    const invited = members.find((m: { email: string }) => m.email === "invited@test.com");
    expect(invited).toBeTruthy();
    const invitedId = invited.id;

    // 3. Change role to "member"
    const roleRes = await request.patch(`/api/admin/org/members/${invitedId}/role`, {
      data: { role: "member" },
    });
    expect(roleRes.ok()).toBe(true);

    // 4. Update permissions
    const permsRes = await request.patch(`/api/admin/org/members/${invitedId}/permissions`, {
      data: { canCreateDataSources: true },
    });
    expect(permsRes.ok()).toBe(true);

    // 5. Remove the invited user
    const deleteRes = await request.delete(`/api/admin/org/members/${invitedId}`);
    expect(deleteRes.ok()).toBe(true);

    // 6. Verify they're gone
    const afterRes = await request.get("/api/admin/org/members");
    const afterMembers = await afterRes.json();
    const removed = afterMembers.find((m: { email: string }) => m.email === "invited@test.com");
    expect(removed).toBeFalsy();
  });
});
