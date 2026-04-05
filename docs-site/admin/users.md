# Users & Roles

Edgebric supports multiple users with role-based access control. Admins invite members, assign roles, and control what each person can do.

## Roles

| Role | Description |
|------|-------------|
| **Owner** | The person who set up Edgebric. Full access to everything. Cannot be removed. |
| **Admin** | Can manage data sources, users, models, and settings. Cannot remove the owner. |
| **Member** | Can query data sources they have access to, participate in group chats, and create vault sources. |

## Inviting Members

1. Go to **Admin** > **Members**
2. Click **Invite**
3. Enter the person's email address
4. Choose a role: **Admin** or **Member**
5. Click **Send Invite**

The invited person can now sign in using the configured identity provider (Google or Microsoft). No separate account creation is needed — their identity comes from the SSO provider.

## Permissions

Beyond roles, each member has individual permissions:

| Permission | Default | Description |
|------------|---------|-------------|
| **Can create data sources** | Members: No, Admins: Yes | Allows creating new data sources |
| **Can create group chats** | Yes | Allows creating group chats |

Admins can toggle these per user in **Admin** > **Members** > click a member > **Permissions**.

## Managing Members

### Change Role

1. Go to **Admin** > **Members**
2. Click a member
3. Change their role from the dropdown

### Update Permissions

1. Click a member in the members list
2. Toggle individual permissions on or off

### Remove a Member

1. Click a member in the members list
2. Click **Remove**
3. Confirm the removal

When a member is removed:

- Their active sessions are revoked
- They lose access to all data sources
- They're removed from all group chats
- They're removed from all mesh groups
- Their vault sources remain on their device (Edgebric can't delete local vault data)

## Data Source Access

Beyond roles and permissions, each data source has its own access control:

- **All** — Every org member can query the source
- **Restricted** — Only specific users on the access list can query it

Admins configure per-source access in the data source settings. See [Security](/admin/security) for more details.

## Solo Mode

In Solo mode, there's only one user — you. No roles, no invites, no authentication. Everything is accessible. This is the simplest setup for personal use.

If you later want to add other users, you can switch to Admin mode by configuring an identity provider in the settings.
