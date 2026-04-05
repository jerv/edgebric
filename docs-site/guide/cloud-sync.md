# Cloud Sync

Edgebric can pull documents from cloud storage services and keep them in sync. Documents are downloaded to your local machine — they're never stored in the cloud by Edgebric.

::: info Supported Providers
- Google Drive
- OneDrive / SharePoint
- Confluence (coming soon)
- Notion (coming soon)
:::

## How Cloud Sync Works

1. You connect a cloud storage account (Google or Microsoft)
2. You choose which folders to sync to a data source
3. Edgebric downloads the documents and processes them
4. On a schedule (or manually), Edgebric checks for new or updated files and syncs them

Documents are always stored locally after download. If you disconnect the cloud account, the already-synced documents remain in your data source.

## Google Drive Setup

### Prerequisites

- A Google account with access to the files you want to sync
- An admin must have configured Google OAuth credentials (see [Integrations](/admin/integrations))

### Steps

1. Go to **Library** and open the data source you want to sync into (or create a new one)
2. Click **Connect Cloud Storage**
3. Select **Google Drive**
4. Sign in with your Google account and authorize Edgebric
5. Browse your Drive folders and select the ones to sync
6. Click **Start Sync**

<!-- TODO: Add screenshot of Google Drive folder picker -->

### What Gets Synced

- PDF, DOCX, TXT, and MD files in the selected folders
- Google Docs are exported as DOCX before download
- Subfolders are included by default
- New files added to synced folders are picked up automatically

## OneDrive / SharePoint Setup

### Prerequisites

- A Microsoft account (personal or work/school)
- An admin must have configured Microsoft OAuth credentials (see [Integrations](/admin/integrations))

### Steps

1. Go to **Library** and open a data source
2. Click **Connect Cloud Storage**
3. Select **OneDrive**
4. Sign in with your Microsoft account and authorize Edgebric
5. Browse your OneDrive or SharePoint folders
6. Select folders and click **Start Sync**

<!-- TODO: Add screenshot of OneDrive folder picker -->

## Managing Syncs

### Sync Status

Each folder sync shows its current status:

- **Syncing** — Currently downloading and processing files
- **Up to date** — All files have been synced
- **Error** — Something went wrong (check the sync details for more info)

### Manual Sync

Click the **Sync Now** button on any folder sync to immediately check for changes, rather than waiting for the next scheduled sync.

### Sync Interval

By default, Edgebric checks for changes periodically. You can adjust the interval per folder sync, or trigger manual syncs at any time.

### Disconnecting

To stop syncing a folder:

1. Go to the data source
2. Find the folder sync in the cloud sync section
3. Click **Disconnect**

Already-downloaded documents remain in the data source. Only the ongoing sync is stopped.

To remove the cloud account connection entirely:

1. Go to **Settings** > **Cloud Connections**
2. Find the connection and click **Delete**

This stops all syncs using that connection. Documents already downloaded are not affected.
