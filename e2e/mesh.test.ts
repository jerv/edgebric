import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";

/**
 * Mesh Networking — full lifecycle E2E tests.
 *
 * Covers: initialize mesh as primary, register nodes, create node groups,
 * assign nodes to groups, peer protocol (search/heartbeat/info/auth-info),
 * mesh token regeneration, update config, disable mesh, leave mesh.
 *
 * Runs in solo mode — admin user can configure mesh.
 */

test.describe("Mesh Configuration", () => {
  test("mesh is not configured initially", async ({ request }) => {
    const res = await request.get("/api/mesh/config");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.enabled).toBe(false);
  });

  test("mesh status shows disabled", async ({ request }) => {
    const res = await request.get("/api/mesh/status");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });
});

test.describe("Mesh Full Lifecycle", () => {
  let meshToken: string;
  let nodeId: string;
  let groupId: string;

  test("initializes mesh as primary", async ({ request }) => {
    const res = await request.post("/api/mesh/config", {
      data: {
        role: "primary",
        nodeName: "E2E Primary Node",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("primary");
    expect(body.nodeName).toBe("E2E Primary Node");
    expect(body.meshToken).toBeTruthy();
    expect(body.enabled).toBe(true);
    meshToken = body.meshToken;
  });

  test("mesh config shows configured and enabled", async ({ request }) => {
    const res = await request.get("/api/mesh/config");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.role).toBe("primary");
    // Token should be masked in GET response
    expect(body.meshToken).not.toBe(meshToken);
  });

  test("gets full mesh token", async ({ request }) => {
    const res = await request.get("/api/mesh/config/token");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.meshToken).toBe(meshToken);
  });

  test("mesh status shows enabled", async ({ request }) => {
    const res = await request.get("/api/mesh/status");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.role).toBe("primary");
    expect(body.nodeName).toBe("E2E Primary Node");
  });

  // ─── Node Groups ───────────────────────────────────────────────────

  test("creates a node group", async ({ request }) => {
    const res = await request.post("/api/mesh/groups", {
      data: {
        name: "E2E West Coast",
        description: "West coast offices",
        color: "#3B82F6",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("E2E West Coast");
    expect(body.color).toBe("#3B82F6");
    groupId = body.id;
  });

  test("lists node groups", async ({ request }) => {
    const res = await request.get("/api/mesh/groups");
    expect(res.ok()).toBe(true);
    const groups = await res.json();
    const found = groups.find((g: { id: string }) => g.id === groupId);
    expect(found).toBeDefined();
    expect(found.name).toBe("E2E West Coast");
  });

  test("updates a node group", async ({ request }) => {
    const res = await request.patch(`/api/mesh/groups/${groupId}`, {
      data: { name: "E2E Pacific Region", description: "Updated" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("E2E Pacific Region");
  });

  // ─── Node Registration ────────────────────────────────────────────

  test("registers a remote node", async ({ request }) => {
    nodeId = randomUUID();
    const res = await request.post("/api/mesh/nodes", {
      data: {
        id: nodeId,
        name: "E2E Branch Office",
        role: "secondary",
        endpoint: "https://branch.example.com",
        version: "0.5.0",
        groupId,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(nodeId);
    expect(body.name).toBe("E2E Branch Office");
    expect(body.role).toBe("secondary");
    expect(body.groupId).toBe(groupId);
  });

  test("lists nodes and finds the registered one", async ({ request }) => {
    const res = await request.get("/api/mesh/nodes");
    expect(res.ok()).toBe(true);
    const nodes = await res.json();
    expect(Array.isArray(nodes)).toBe(true);
    const found = nodes.find((n: { id: string }) => n.id === nodeId);
    expect(found).toBeDefined();
    expect(found.name).toBe("E2E Branch Office");
    expect(found.groupId).toBe(groupId);
  });

  test("gets a single node by ID", async ({ request }) => {
    const res = await request.get(`/api/mesh/nodes/${nodeId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBe(nodeId);
    expect(body.name).toBe("E2E Branch Office");
  });

  test("updates a node", async ({ request }) => {
    const res = await request.patch(`/api/mesh/nodes/${nodeId}`, {
      data: { name: "E2E Branch Office (Updated)" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("E2E Branch Office (Updated)");
  });

  test("returns 404 for non-existent node", async ({ request }) => {
    const res = await request.get(`/api/mesh/nodes/${randomUUID()}`);
    expect(res.status()).toBe(404);
  });

  // ─── Query Targets ────────────────────────────────────────────────

  test("query targets include the node group", async ({ request }) => {
    const res = await request.get("/api/mesh/query-targets");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.groups).toBeDefined();
    const found = body.groups.find((g: { id: string }) => g.id === groupId);
    expect(found).toBeDefined();
    expect(found.nodeCount).toBeGreaterThanOrEqual(1);
  });

  // ─── Peer Protocol (MeshToken auth) ───────────────────────────────

  test("peer heartbeat with valid MeshToken", async ({ request }) => {
    const res = await request.post("/api/mesh/peer/heartbeat", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": nodeId,
      },
      data: { sourceCount: 5, version: "0.5.1" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("peer info returns node details", async ({ request }) => {
    const res = await request.get("/api/mesh/peer/info", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": nodeId,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.nodeId).toBeTruthy();
    expect(body.nodeName).toBe("E2E Primary Node");
    expect(body.role).toBe("primary");
  });

  test("peer auth-info returns provider info", async ({ request }) => {
    const res = await request.get("/api/mesh/peer/auth-info", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": nodeId,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // In solo mode, provider is "none" or "generic"
    expect(body.provider).toBeTruthy();
    expect(body.providerName).toBeTruthy();
  });

  test("peer search returns results (empty since no docs indexed)", async ({ request }) => {
    const res = await request.post("/api/mesh/peer/search", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": nodeId,
      },
      data: { query: "test query", topN: 5 },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.chunks).toBeDefined();
    expect(Array.isArray(body.chunks)).toBe(true);
    expect(body.nodeId).toBeTruthy();
    expect(body.nodeName).toBeTruthy();
  });

  test("peer endpoints reject missing MeshToken", async ({ request }) => {
    const res = await request.get("/api/mesh/peer/info");
    expect(res.status()).toBe(401);
  });

  test("peer endpoints reject invalid MeshToken", async ({ request }) => {
    const res = await request.get("/api/mesh/peer/info", {
      headers: {
        Authorization: "MeshToken invalid-token",
        "X-Mesh-Node-Id": nodeId,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("peer endpoints reject missing X-Mesh-Node-Id", async ({ request }) => {
    const res = await request.get("/api/mesh/peer/info", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
      },
    });
    expect(res.status()).toBe(400);
  });

  test("peer endpoints reject unregistered node ID", async ({ request }) => {
    const res = await request.get("/api/mesh/peer/info", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": randomUUID(),
      },
    });
    expect(res.status()).toBe(403);
  });

  // ─── Token Regeneration ───────────────────────────────────────────

  test("regenerates mesh token", async ({ request }) => {
    const res = await request.post("/api/mesh/config/regenerate-token");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.meshToken).toBeTruthy();
    expect(body.meshToken).not.toBe(meshToken);
    // Old token should no longer work
    const oldTokenRes = await request.get("/api/mesh/peer/info", {
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": nodeId,
      },
    });
    expect(oldTokenRes.status()).toBe(403);

    meshToken = body.meshToken;
  });

  // ─── Config Updates ───────────────────────────────────────────────

  test("updates mesh node name", async ({ request }) => {
    const res = await request.patch("/api/mesh/config", {
      data: { nodeName: "E2E Primary (Renamed)" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.nodeName).toBe("E2E Primary (Renamed)");
  });

  test("disables mesh", async ({ request }) => {
    const res = await request.patch("/api/mesh/config", {
      data: { enabled: false },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.enabled).toBe(false);

    // Status should reflect disabled
    const status = await request.get("/api/mesh/status");
    const statusBody = await status.json();
    expect(statusBody.enabled).toBe(false);
  });

  test("re-enables mesh", async ({ request }) => {
    const res = await request.patch("/api/mesh/config", {
      data: { enabled: true },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.enabled).toBe(true);
  });

  // ─── Cleanup ──────────────────────────────────────────────────────

  test("removes a node", async ({ request }) => {
    const res = await request.delete(`/api/mesh/nodes/${nodeId}`);
    expect(res.ok()).toBe(true);
  });

  test("deletes a node group", async ({ request }) => {
    const res = await request.delete(`/api/mesh/groups/${groupId}`);
    expect(res.ok()).toBe(true);
  });

  test("leaves mesh entirely", async ({ request }) => {
    const res = await request.delete("/api/mesh/config");
    expect(res.ok()).toBe(true);

    // Verify unconfigured
    const check = await request.get("/api/mesh/config");
    const body = await check.json();
    expect(body.configured).toBe(false);
  });
});
