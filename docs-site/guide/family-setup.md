# Family Setup

Edgebric works great as a private family knowledge base. Set it up on a Mac at home, sign in with Google, and everyone in the family can search shared documents — tax records, school papers, medical info, recipes, or anything else.

## What You Need

- A Mac running Edgebric (even an older Mac Mini works for a small family)
- A Google account for each family member who will sign in

## Step-by-Step Setup

### 1. Install Edgebric

Download from [edgebric.com](https://edgebric.com) or use the one-line installer:

```bash
curl -fsSL https://edgebric.com/install.sh | bash
```

### 2. Choose Admin Mode

During first-run setup, choose **Admin** mode. This enables authentication so each family member gets their own account.

### 3. Set Up Google Sign-In

Follow the [Google OIDC setup guide](/admin/auth#google-oidc). You'll need to:

1. Create a Google Cloud project (free)
2. Enable the OAuth consent screen
3. Create OAuth credentials
4. Enter the client ID and secret in Edgebric's setup wizard

::: tip
You only need to do this once. After setup, signing in is as simple as clicking "Sign in with Google."
:::

### 4. Add Family Members

1. Open Edgebric in your browser
2. Go to **Admin** > **Members**
3. Click **Invite** and enter each family member's Gmail address
4. They'll be able to sign in with their Google account

### 5. Create Shared Sources

Create data sources for different categories:

- **Family Documents** — Tax returns, insurance papers, warranties
- **School** — Report cards, school policies, homework references
- **Medical** — Doctor's notes, prescription info, insurance cards
- **Recipes** — Family recipes, meal plans
- **Home** — Appliance manuals, HOA documents, home maintenance records

Upload documents to each source by dragging and dropping files.

### 6. Set Up Personal Vaults

Each family member can create their own **Vault source** for private documents that only they can access. Vault sources are encrypted and invisible to other family members.

## Using It Day-to-Day

Once set up, anyone in the family can:

- Open Edgebric in their browser (same WiFi network)
- Sign in with Google
- Ask questions like:
  - "When does our car insurance expire?"
  - "What's the recipe for grandma's lasagna?"
  - "What vaccinations does [child] need for school?"
- Get answers with citations pointing to the exact document

## Tips

- **Keep the Mac running** — Edgebric needs to be running on the host Mac for others to access it. A Mac Mini on a shelf is ideal.
- **Use Vault for sensitive items** — Tax returns or medical records that should be private to one person belong in a Vault source, not a shared source.
- **Update regularly** — When you get new documents (insurance renewals, school forms), upload them to keep answers current. Edgebric flags documents older than 6 months as potentially stale.
