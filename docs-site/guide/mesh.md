# Mesh Networking

Mesh networking is Edgebric's approach to distributed knowledge: put a Mac in each office or department, and queries fan out across all of them. Documents never move between machines — only the query and the relevant answer snippets travel across the network.

## Why Mesh?

Most knowledge platforms centralize your documents in one place. Edgebric does the opposite.

**Example:** Put a Mac Mini in your New York office with HR documents. Another in London with legal contracts. A third in Tokyo with engineering specs. When someone asks a question, Edgebric queries all three simultaneously and merges the results — but no document ever crosses the network.

- A single Mac Mini M4 ($699) can serve 100–200 daily users
- Three of them give you a globally distributed, private knowledge platform for under $2,100 in hardware
- Security is enforced by physics: a compromised node literally cannot access another department's data because that data isn't on the machine

## Concepts

### Primary Node

One node acts as the primary. It:

- Handles user authentication (OIDC/SSO)
- Coordinates cross-node queries
- Manages the node registry

### Secondary Nodes

All other nodes are secondaries. They:

- Hold their own documents and data sources
- Respond to search queries from the primary
- Report health status via heartbeats

### Node Groups

Organize nodes by department, office, or sensitivity level. When a user queries, Edgebric can route the query only to relevant groups based on the user's access permissions.

## Setting Up the Primary Node

1. Install Edgebric on the Mac that will be your primary
2. During setup, choose **Admin** mode
3. Configure authentication ([see Auth Setup](/admin/auth))
4. In **Admin** > **Mesh**, click **Initialize Mesh**
5. Choose **Primary** role
6. Give the node a name (e.g., "HQ Server" or "Engineering")
7. A mesh token is generated — you'll need this for secondary nodes

## Adding Secondary Nodes

1. Install Edgebric on another Mac
2. During setup, choose **Admin** mode
3. In **Admin** > **Mesh**, click **Initialize Mesh**
4. Choose **Secondary** role
5. Enter the primary node's address and mesh token
6. The secondary registers with the primary and starts sending heartbeats

Repeat for each additional node.

## How Queries Work Across Nodes

When a user asks a question:

1. The query goes to the primary node
2. The primary fans out the query to all healthy secondary nodes in parallel
3. Each node searches its own documents locally (vector + keyword search)
4. Each node returns only the relevant text snippets — not full documents
5. The primary merges results from all nodes
6. The AI model generates an answer with citations tagged by source and node
7. The answer streams back to the user

If a node is offline, the query proceeds without it. The answer notes which nodes were unavailable.

## Health & Monitoring

Each node sends a heartbeat every 30 seconds. The primary tracks:

| Status | Meaning |
|--------|---------|
| **Online** | Healthy, responding to queries |
| **Offline** | No heartbeat for 90+ seconds |
| **Connecting** | Recently discovered, not yet confirmed |

View node status in **Admin** > **Mesh**. Offline nodes automatically reconnect when they come back.

## Mesh Token Security

The mesh token authenticates communication between nodes. Treat it like a password:

- Share it only with trusted administrators setting up secondary nodes
- Rotate it periodically from **Admin** > **Mesh** > **Rotate Token**
- If a node is compromised, rotate the token immediately — this disconnects the compromised node

## Node Groups

Create groups to organize nodes:

1. Go to **Admin** > **Mesh** > **Groups**
2. Create a group (e.g., "Legal Department", "Tokyo Office")
3. Assign nodes to groups
4. Assign user access by group

Users only query the nodes in groups they have access to. This provides department-level isolation on top of the physical isolation.

## Network Requirements

- All nodes must be reachable over the network (same LAN, VPN, or public internet)
- HTTPS is used for all inter-node communication
- The primary node generates self-signed TLS certificates during setup
- Typical bandwidth usage is minimal — only queries and answer snippets are transmitted
