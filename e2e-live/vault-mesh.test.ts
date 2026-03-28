import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";

/**
 * Vault & Mesh Tests — Core distributed features.
 *
 * Vault tests verify:
 * - Data source vault sync flag controls
 * - Source viewing permissions
 * - External access controls
 *
 * Mesh tests verify:
 * - Mesh config initialization (primary node)
 * - Node registration and management
 * - Node group CRUD
 * - Mesh status endpoint
 * - Token management (regeneration, partial display)
 * - Mesh teardown (leave mesh)
 *
 * Note: True multi-node mesh tests require 2+ machines on the same LAN.
 * These tests validate the config/management layer against a single node.
 */

test.describe("Vault Controls", () => {
  let sourceId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/data-sources", {
      data: { name: "Vault Test Source" },
    });
    const ds = await res.json();
    sourceId = ds.id;
  });

  test.afterAll(async ({ request }) => {
    if (sourceId) await request.delete(`/api/data-sources/${sourceId}`);
  });

  test("vault sync can be enabled on a data source", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${sourceId}`, {
      data: { allowVaultSync: true },
    });
    expect(res.ok()).toBe(true);
    const ds = await res.json();
    expect(ds.allowVaultSync).toBe(true);
  });

  test("vault sync can be disabled", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${sourceId}`, {
      data: { allowVaultSync: false },
    });
    expect(res.ok()).toBe(true);
    const ds = await res.json();
    expect(ds.allowVaultSync).toBe(false);
  });

  test("source viewing permission can be toggled", async ({ request }) => {
    // Disable
    let res = await request.put(`/api/data-sources/${sourceId}`, {
      data: { allowSourceViewing: false },
    });
    expect(res.ok()).toBe(true);
    let ds = await res.json();
    expect(ds.allowSourceViewing).toBe(false);

    // Enable
    res = await request.put(`/api/data-sources/${sourceId}`, {
      data: { allowSourceViewing: true },
    });
    expect(res.ok()).toBe(true);
    ds = await res.json();
    expect(ds.allowSourceViewing).toBe(true);
  });

  test("external access permission can be toggled", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${sourceId}`, {
      data: { allowExternalAccess: true },
    });
    expect(res.ok()).toBe(true);
    const ds = await res.json();
    expect(ds.allowExternalAccess).toBe(true);

    const res2 = await request.put(`/api/data-sources/${sourceId}`, {
      data: { allowExternalAccess: false },
    });
    expect(res2.ok()).toBe(true);
    const ds2 = await res2.json();
    expect(ds2.allowExternalAccess).toBe(false);
  });
});

test.describe.serial("Mesh Configuration", () => {
  // Clean up any existing mesh config before and after
  test.beforeAll(async ({ request }) => {
    await request.delete("/api/mesh/config");
  });

  test.afterAll(async ({ request }) => {
    await request.delete("/api/mesh/config");
  });

  test("mesh status returns disabled when not configured", async ({ request }) => {
    const res = await request.get("/api/mesh/status");
    expect(res.ok()).toBe(true);
    const status = await res.json();
    expect(status.enabled).toBe(false);
    expect(status.connectedNodes).toBe(0);
  });

  test("mesh config returns unconfigured when not initialized", async ({ request }) => {
    const res = await request.get("/api/mesh/config");
    expect(res.ok()).toBe(true);
    const cfg = await res.json();
    expect(cfg.configured).toBe(false);
  });

  test("initializes mesh as primary node", async ({ request }) => {
    const res = await request.post("/api/mesh/config", {
      data: {
        role: "primary",
        nodeName: "E2E Primary Node",
      },
    });
    expect(res.status()).toBe(201);
    const cfg = await res.json();

    expect(cfg.role).toBe("primary");
    expect(cfg.nodeName).toBe("E2E Primary Node");
    expect(cfg.meshToken).toBeDefined();
    expect(cfg.meshToken.length).toBeGreaterThan(10);
    expect(cfg.nodeId).toBeDefined();
    expect(cfg.enabled).toBe(true);
  });

  test("mesh status shows enabled after init", async ({ request }) => {
    const res = await request.get("/api/mesh/status");
    expect(res.ok()).toBe(true);
    const status = await res.json();
    expect(status.enabled).toBe(true);
    expect(status.role).toBe("primary");
    expect(status.nodeName).toBe("E2E Primary Node");
  });

  test("mesh config shows masked token", async ({ request }) => {
    const res = await request.get("/api/mesh/config");
    expect(res.ok()).toBe(true);
    const cfg = await res.json();
    expect(cfg.configured).toBe(true);
    expect(cfg.meshToken).toMatch(/^\.\.\./); // masked with "..."
  });

  test("full mesh token is retrievable separately", async ({ request }) => {
    const res = await request.get("/api/mesh/config/token");
    expect(res.ok()).toBe(true);
    const { meshToken } = await res.json();
    expect(meshToken).toBeDefined();
    expect(meshToken.length).toBeGreaterThan(10);
    expect(meshToken).not.toMatch(/^\.\.\./); // NOT masked
  });

  test("regenerates mesh token", async ({ request }) => {
    // Get original token
    const origRes = await request.get("/api/mesh/config/token");
    const { meshToken: origToken } = await origRes.json();

    // Regenerate
    const regenRes = await request.post("/api/mesh/config/regenerate-token");
    expect(regenRes.ok()).toBe(true);
    const { meshToken: newToken } = await regenRes.json();

    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(origToken);
  });

  test("updates mesh config (rename node)", async ({ request }) => {
    const res = await request.patch("/api/mesh/config", {
      data: { nodeName: "Renamed Primary" },
    });
    expect(res.ok()).toBe(true);
    const cfg = await res.json();
    expect(cfg.nodeName).toBe("Renamed Primary");
  });

  test("can disable and re-enable mesh", async ({ request }) => {
    // Disable
    let res = await request.patch("/api/mesh/config", {
      data: { enabled: false },
    });
    expect(res.ok()).toBe(true);

    let status = await (await request.get("/api/mesh/status")).json();
    expect(status.enabled).toBe(false);

    // Re-enable
    res = await request.patch("/api/mesh/config", {
      data: { enabled: true },
    });
    expect(res.ok()).toBe(true);

    status = await (await request.get("/api/mesh/status")).json();
    expect(status.enabled).toBe(true);
  });
});

test.describe.serial("Mesh Nodes", () => {
  test.beforeAll(async ({ request }) => {
    // Ensure mesh is configured
    await request.delete("/api/mesh/config");
    await request.post("/api/mesh/config", {
      data: { role: "primary", nodeName: "Node Test Primary" },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete("/api/mesh/config");
  });

  let nodeId: string;

  test("registers a secondary node", async ({ request }) => {
    nodeId = randomUUID();
    const res = await request.post("/api/mesh/nodes", {
      data: {
        id: nodeId,
        name: "E2E Secondary Node",
        role: "secondary",
        endpoint: "https://192.168.1.100:3001",
        version: "1.0.0",
      },
    });
    expect(res.status()).toBe(201);
    const node = await res.json();
    expect(node.id).toBe(nodeId);
    expect(node.name).toBe("E2E Secondary Node");
    expect(node.role).toBe("secondary");
  });

  test("lists registered nodes", async ({ request }) => {
    const res = await request.get("/api/mesh/nodes");
    expect(res.ok()).toBe(true);
    const nodes = await res.json();
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some((n: { id: string }) => n.id === nodeId)).toBe(true);
  });

  test("gets a specific node by ID", async ({ request }) => {
    const res = await request.get(`/api/mesh/nodes/${nodeId}`);
    expect(res.ok()).toBe(true);
    const node = await res.json();
    expect(node.name).toBe("E2E Secondary Node");
  });

  test("updates a node", async ({ request }) => {
    const res = await request.patch(`/api/mesh/nodes/${nodeId}`, {
      data: { name: "Renamed Secondary" },
    });
    expect(res.ok()).toBe(true);
    const node = await res.json();
    expect(node.name).toBe("Renamed Secondary");
  });

  test("removes a node", async ({ request }) => {
    const res = await request.delete(`/api/mesh/nodes/${nodeId}`);
    expect(res.ok()).toBe(true);

    // Verify it's gone
    const getRes = await request.get(`/api/mesh/nodes/${nodeId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe.serial("Mesh Node Groups", () => {
  let groupId: string;

  test.beforeAll(async ({ request }) => {
    await request.delete("/api/mesh/config");
    await request.post("/api/mesh/config", {
      data: { role: "primary", nodeName: "Group Test Primary" },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete("/api/mesh/config");
  });

  test("creates a node group", async ({ request }) => {
    const res = await request.post("/api/mesh/groups", {
      data: {
        name: "Engineering Floor",
        description: "Nodes in the engineering wing",
        color: "#3B82F6",
      },
    });
    expect(res.status()).toBe(201);
    const group = await res.json();
    groupId = group.id;
    expect(group.name).toBe("Engineering Floor");
    expect(group.color).toBe("#3B82F6");
  });

  test("lists node groups", async ({ request }) => {
    const res = await request.get("/api/mesh/groups");
    expect(res.ok()).toBe(true);
    const groups = await res.json();
    expect(groups.some((g: { id: string }) => g.id === groupId)).toBe(true);
  });

  test("updates a node group", async ({ request }) => {
    const res = await request.patch(`/api/mesh/groups/${groupId}`, {
      data: { name: "Renamed Group", color: "#EF4444" },
    });
    expect(res.ok()).toBe(true);
    const group = await res.json();
    expect(group.name).toBe("Renamed Group");
    expect(group.color).toBe("#EF4444");
  });

  test("query-targets endpoint returns groups", async ({ request }) => {
    const res = await request.get("/api/mesh/query-targets");
    expect(res.ok()).toBe(true);
    const { groups } = await res.json();
    expect(groups.some((g: { id: string }) => g.id === groupId)).toBe(true);
  });

  test("assigns a node to a group", async ({ request }) => {
    const nodeId = randomUUID();
    await request.post("/api/mesh/nodes", {
      data: {
        id: nodeId,
        name: "Grouped Node",
        role: "secondary",
        endpoint: "https://192.168.1.200:3001",
        groupId,
      },
    });

    const nodeRes = await request.get(`/api/mesh/nodes/${nodeId}`);
    const node = await nodeRes.json();
    expect(node.groupId).toBe(groupId);

    // Cleanup
    await request.delete(`/api/mesh/nodes/${nodeId}`);
  });

  test("deletes a node group", async ({ request }) => {
    const res = await request.delete(`/api/mesh/groups/${groupId}`);
    expect(res.ok()).toBe(true);

    const getRes = await request.get(`/api/mesh/groups/${groupId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe("Mesh Leave", () => {
  test("can leave mesh entirely", async ({ request }) => {
    // Init
    await request.post("/api/mesh/config", {
      data: { role: "primary", nodeName: "Temp Node" },
    });

    // Leave
    const res = await request.delete("/api/mesh/config");
    expect(res.ok()).toBe(true);

    // Verify
    const status = await (await request.get("/api/mesh/status")).json();
    expect(status.enabled).toBe(false);
  });
});
