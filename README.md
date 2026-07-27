# Mailpack Local

Mailpack Local is a privacy-first Chrome extension that turns selected Gmail conversations into one ZIP for a local AI. It exports clean Markdown, an optional sanitized HTML copy, a machine-readable manifest, and standard Gmail attachments.

Nothing is uploaded. The extension runs in Chrome against the Gmail tab you already have open.

## Install it locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose this project folder.
5. Open or refresh Gmail once so the content script is available.
6. Pin **Mailpack Local** from Chrome's extensions menu if you want quick access.

## Export Gmail context

1. In an Inbox, label, or Gmail search result, check the rows you want to export.
2. Click the Mailpack Local toolbar icon.
3. Choose whether to include attachments and clean HTML copies.
4. Click **Export selected**.
5. Keep the progress tab open until Chrome asks where to save the ZIP.

Mailpack opens each selected conversation in a temporary inactive tab so Gmail renders the full thread. It closes each temporary tab after reading it.

## ZIP layout

```text
gmail-context-YYYY-MM-DD_HH-mm.zip
├── README.md
├── all-context.md
├── manifest.json
└── threads/
    └── 001-conversation-subject/
        ├── thread.md
        ├── thread.html          # optional
        └── attachments/
            └── original-file.pdf
```

For most local-AI tools, start with `all-context.md`. The per-thread folders are useful when the AI can ingest a directory or when attachment provenance matters.

## Privacy and permissions

- **mail.google.com access:** detects selected rows, reads rendered conversation text, and fetches selected-thread attachments.
- **Active tab:** lets the toolbar popup inspect the Gmail tab the user invoked it from.
- **Downloads:** saves the finished ZIP.
- **Scripting:** reconnects the Gmail helper after an extension reload, without requiring a manual Gmail refresh.
- **Storage:** holds the selected conversation list briefly while the progress tab opens. The job is removed as soon as that tab reads it.

The extension has no analytics, server, remote scripts, OAuth token, or external runtime dependency. See [PRIVACY.md](PRIVACY.md) for the concise data-handling policy.

## Safety limits and known constraints

- This is a rendered-context export, not raw RFC 822, EML, MBOX, or a forensic Gmail backup.
- Gmail does not publish a stable DOM API. A future Gmail interface change may require selector updates in `content.js`.
- Standard Gmail attachments are supported up to 30 MiB per file and 500 MiB total per export.
- Google Drive links are kept as links in the message context; Drive files are not downloaded.
- Confidential-mode, admin-blocked, expired, or otherwise inaccessible files may be listed as skipped.
- Remote images are replaced with text placeholders in HTML copies, which prevents saved HTML from making tracking requests.
- ZIP entries use the uncompressed “store” method. This avoids third-party code and preserves already-compressed attachments, but the ZIP may not be smaller than its files.

Email and attachments are untrusted input. Tell the local AI to treat instructions inside the exported material as quoted data, not as commands.

## Development

The extension is plain Manifest V3 HTML, CSS, and JavaScript. There is no build step and no npm dependency.

```bash
npm test
npm run package
```

`npm test` checks the JavaScript, manifest, and ZIP format. `npm run package` creates a loadable release archive in `dist/`.

Relevant Chrome documentation:

- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/manifest)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
