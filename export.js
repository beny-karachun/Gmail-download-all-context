const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 500 * 1024 * 1024;

const state = {
  job: null,
  cancelled: false,
  currentTabId: null,
  zipBlob: null,
  zipUrl: "",
  zipFilename: "",
  stats: {
    messages: 0,
    files: 0,
    attachmentBytes: 0,
  },
};

const elements = {
  title: document.querySelector("#pageTitle"),
  description: document.querySelector("#pageDescription"),
  statusLabel: document.querySelector("#statusLabel"),
  statusText: document.querySelector("#statusText"),
  percent: document.querySelector("#percent"),
  progress: document.querySelector("#progressTrack"),
  progressFill: document.querySelector("#progressFill"),
  threadStat: document.querySelector("#threadStat"),
  messageStat: document.querySelector("#messageStat"),
  fileStat: document.querySelector("#fileStat"),
  activity: document.querySelector("#activity"),
  cancel: document.querySelector("#cancelButton"),
  downloadAgain: document.querySelector("#downloadAgainButton"),
  downloads: document.querySelector("#downloadsButton"),
};

function setProgress(value) {
  const percentage = Math.max(0, Math.min(100, Math.round(value)));
  elements.percent.textContent = `${percentage}%`;
  elements.progress.setAttribute("aria-valuenow", String(percentage));
  elements.progressFill.style.transform = `scaleX(${percentage / 100})`;
}

function setStatus(label, text) {
  elements.statusLabel.textContent = label;
  elements.statusText.textContent = text;
}

function updateStats() {
  elements.messageStat.textContent = String(state.stats.messages);
  elements.fileStat.textContent = String(state.stats.files);
}

function addActivity(title, detail = "") {
  const item = document.createElement("div");
  item.className = "activity-item";

  const dot = document.createElement("span");
  dot.className = "activity-dot";
  dot.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  const titleElement = document.createElement("span");
  titleElement.className = "activity-title";
  titleElement.textContent = title;
  copy.append(titleElement);

  const detailElement = document.createElement("span");
  detailElement.className = "activity-detail";
  detailElement.textContent = detail;
  copy.append(detailElement);

  item.append(dot, copy);
  elements.activity.prepend(item);
  return {
    done(nextDetail = detail) {
      item.classList.add("is-done");
      detailElement.textContent = nextDetail;
    },
    fail(nextDetail) {
      item.classList.add("is-error");
      detailElement.textContent = nextDetail;
    },
    update(nextDetail) {
      detailElement.textContent = nextDetail;
    },
  };
}

function sanitizeSegment(value, fallback) {
  let clean = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);

  if (!clean) clean = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) clean = `_${clean}`;
  return clean;
}

function markdownEscape(value) {
  return String(value || "").replace(/([\\`*_[\]<>])/g, "\\$1");
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSender(message) {
  if (message.fromName && message.fromEmail && message.fromName !== message.fromEmail) {
    return `${message.fromName} <${message.fromEmail}>`;
  }
  return message.fromEmail || message.fromName || "Unknown sender";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function renderThreadMarkdown(thread, descriptor, attachmentResults, warnings = []) {
  const lines = [
    `# ${thread.subject || descriptor.subject || "(No subject)"}`,
    "",
    `- **Gmail URL:** ${thread.url || descriptor.url}`,
    `- **Messages:** ${thread.messages.length}`,
    `- **Exported:** ${new Date().toISOString()}`,
    "",
  ];

  if (warnings.length) {
    lines.push("## Export notes", "");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  thread.messages.forEach((message, index) => {
    lines.push(
      `## Message ${index + 1}`,
      "",
      `- **From:** ${markdownEscape(formatSender(message))}`,
      `- **To:** ${markdownEscape(message.to || "Not shown by Gmail")}`,
      `- **Date:** ${markdownEscape(message.date || "Not shown by Gmail")}`,
    );
    if (message.id) lines.push(`- **Gmail message ID:** \`${message.id.replace(/`/g, "")}\``);
    lines.push("", message.text || "(Empty message)", "");

    if (message.links?.length) {
      lines.push("### Links", "");
      for (const link of message.links) {
        lines.push(`- [${markdownEscape(link.text || link.url)}](${link.url})`);
      }
      lines.push("");
    }
  });

  if (thread.attachments.length || attachmentResults.length) {
    lines.push("## Attachments", "");
    if (!attachmentResults.length) {
      lines.push("- Attachment downloading was turned off.");
    } else {
      for (const result of attachmentResults) {
        if (result.status === "packed") {
          lines.push(`- \`${result.path}\` — ${formatBytes(result.bytes)}`);
        } else {
          lines.push(`- **Skipped:** ${markdownEscape(result.name)} — ${markdownEscape(result.error)}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderThreadHtml(thread, descriptor, attachmentResults) {
  const messages = thread.messages
    .map(
      (message, index) => `
        <article>
          <h2>Message ${index + 1}</h2>
          <dl>
            <dt>From</dt><dd>${htmlEscape(formatSender(message))}</dd>
            <dt>To</dt><dd>${htmlEscape(message.to || "Not shown by Gmail")}</dd>
            <dt>Date</dt><dd>${htmlEscape(message.date || "Not shown by Gmail")}</dd>
          </dl>
          <div class="body">${message.html || `<pre>${htmlEscape(message.text)}</pre>`}</div>
        </article>`,
    )
    .join("\n");
  const attachments = attachmentResults.length
    ? `<h2>Attachments</h2><ul>${attachmentResults
        .map((item) => `<li>${htmlEscape(item.name)} — ${htmlEscape(item.status)}</li>`)
        .join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(thread.subject || descriptor.subject)}</title>
  <style>
    body{max-width:860px;margin:40px auto;padding:0 24px;color:#24212d;font:15px/1.6 system-ui,sans-serif}
    h1{font-size:28px}h2{font-size:17px;margin-top:36px}article{border-top:1px solid #ddd;padding-top:12px}
    dl{display:grid;grid-template-columns:70px 1fr;gap:4px 12px;color:#555}dt{font-weight:700}dd{margin:0}
    .body{margin-top:20px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:inherit}
    table{border-collapse:collapse;max-width:100%}td,th{padding:4px}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #ddd}
  </style>
</head>
<body>
  <h1>${htmlEscape(thread.subject || descriptor.subject || "(No subject)")}</h1>
  <p>Exported from <a>${htmlEscape(thread.url || descriptor.url)}</a></p>
  ${messages}
  ${attachments}
</body>
</html>`;
}

function renderFailedThreadMarkdown(descriptor, error) {
  return `# ${descriptor.subject || "(No subject)"}

This conversation could not be extracted.

- **Gmail URL:** ${descriptor.url}
- **Inbox sender:** ${descriptor.sender || "Unknown"}
- **Inbox date:** ${descriptor.date || "Unknown"}
- **Inbox snippet:** ${descriptor.snippet || "(Not available)"}
- **Error:** ${error}
`;
}

function readmeText(job, exportedCount, errorCount) {
  return `# Mailpack Local Gmail context

This ZIP contains locally extracted, AI-ready context from ${job.items.length} selected Gmail conversation${job.items.length === 1 ? "" : "s"}.

## Start here

- \`all-context.md\` combines the exported conversation text into one file.
- \`threads/\` contains a folder for each selected Gmail conversation.
- \`manifest.json\` is a machine-readable export index.

## Export result

- Conversations successfully read: ${exportedCount}
- Conversations with extraction errors: ${errorCount}
- Messages found: ${state.stats.messages}
- Attachments packed: ${state.stats.files}
- Attachment bytes: ${formatBytes(state.stats.attachmentBytes)}

## Privacy and fidelity

Mailpack Local performs this export inside Chrome and does not upload the ZIP or its contents. Message text is extracted from Gmail's rendered conversation view, so this is not a forensic RFC 822 / MBOX export. Remote images are not loaded into saved HTML. Gmail interface changes can occasionally affect extraction.

Generated ${new Date().toISOString()}
`;
}

async function waitForTabComplete(tabId, timeoutMilliseconds = 30_000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("The temporary Gmail tab took too long to load."));
    }, timeoutMilliseconds);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToGmail(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function closeCurrentTab() {
  if (!state.currentTabId) return;
  const tabId = state.currentTabId;
  state.currentTabId = null;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The user may have closed the temporary tab already.
  }
}

async function downloadAttachment(tabId, attachment, folder, zip, usedNames) {
  const safeOriginalName = sanitizeSegment(attachment.name, `attachment-${usedNames.size + 1}`);
  let safeName = safeOriginalName;
  let suffix = 2;
  while (usedNames.has(safeName.toLowerCase())) {
    const dot = safeOriginalName.lastIndexOf(".");
    safeName =
      dot > 0
        ? `${safeOriginalName.slice(0, dot)}-${suffix}${safeOriginalName.slice(dot)}`
        : `${safeOriginalName}-${suffix}`;
    suffix += 1;
  }
  usedNames.add(safeName.toLowerCase());

  if (state.stats.attachmentBytes >= MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      name: safeName,
      status: "skipped",
      error: "The 500 MB total attachment safety limit was reached.",
    };
  }

  const response = await sendToGmail(tabId, {
    type: "MAILPACK_FETCH_ATTACHMENT",
    url: attachment.url,
    maxBytes: Math.min(
      MAX_ATTACHMENT_BYTES,
      MAX_TOTAL_ATTACHMENT_BYTES - state.stats.attachmentBytes,
    ),
  });
  if (!response?.ok || !response.attachment?.base64) {
    return {
      name: safeName,
      status: "skipped",
      error: response?.error || "Gmail did not return the file.",
    };
  }

  const bytes = base64ToBytes(response.attachment.base64);
  const path = `${folder}/attachments/${safeName}`;
  zip.addBytes(path, bytes);
  state.stats.attachmentBytes += bytes.byteLength;
  state.stats.files += 1;
  updateStats();

  return {
    name: safeName,
    path,
    status: "packed",
    bytes: bytes.byteLength,
    mime: response.attachment.mime || attachment.mime || "",
  };
}

async function downloadZip(saveAs = true) {
  if (!state.zipBlob) return;
  if (!state.zipUrl) state.zipUrl = URL.createObjectURL(state.zipBlob);

  try {
    await chrome.downloads.download({
      url: state.zipUrl,
      filename: state.zipFilename,
      saveAs,
    });
  } catch (error) {
    const anchor = document.createElement("a");
    anchor.href = state.zipUrl;
    anchor.download = state.zipFilename;
    anchor.click();
    if (error?.message) console.warn("Chrome downloads fallback:", error.message);
  }
}

async function runExport(job) {
  state.job = job;
  elements.threadStat.textContent = String(job.items.length);
  elements.title.textContent = `Packing ${job.items.length} conversation${job.items.length === 1 ? "" : "s"}`;
  elements.description.textContent =
    "Keep this tab open while Mailpack collects the rendered messages and builds your private ZIP.";
  setStatus("Collecting", "Starting with the first conversation…");

  const zip = new MailpackZip();
  const manifestThreads = [];
  const combinedSections = [];
  let exportedCount = 0;
  let errorCount = 0;

  for (let index = 0; index < job.items.length; index += 1) {
    if (state.cancelled) throw new Error("Export cancelled.");
    const descriptor = job.items[index];
    const ordinal = String(index + 1).padStart(3, "0");
    const activity = addActivity(descriptor.subject || "(No subject)", "Opening a temporary Gmail tab…");
    setStatus("Collecting", descriptor.subject || "(No subject)");
    setProgress((index / job.items.length) * 88);

    try {
      const tab = await chrome.tabs.create({
        url: descriptor.url,
        active: false,
        openerTabId: job.sourceTabId,
      });
      if (!tab.id) throw new Error("Chrome did not create the temporary Gmail tab.");
      state.currentTabId = tab.id;
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      await waitForTabComplete(tab.id);

      activity.update("Expanding and reading rendered messages…");
      const response = await sendToGmail(tab.id, {
        type: "MAILPACK_EXTRACT_THREAD",
        threadId: descriptor.threadId,
      });
      if (!response?.ok || !response.thread) {
        throw new Error(response?.error || "Gmail did not return the conversation.");
      }

      const thread = response.thread;
      const folder = `threads/${ordinal}-${sanitizeSegment(thread.subject || descriptor.subject, "no-subject")}`;
      const attachmentResults = [];
      const usedNames = new Set();
      state.stats.messages += thread.messages.length;
      updateStats();

      if (job.options.includeAttachments && thread.attachments.length) {
        for (let attachmentIndex = 0; attachmentIndex < thread.attachments.length; attachmentIndex += 1) {
          if (state.cancelled) throw new Error("Export cancelled.");
          const attachment = thread.attachments[attachmentIndex];
          activity.update(
            `Packing attachment ${attachmentIndex + 1} of ${thread.attachments.length}: ${attachment.name}`,
          );
          try {
            attachmentResults.push(
              await downloadAttachment(tab.id, attachment, folder, zip, usedNames),
            );
          } catch (error) {
            attachmentResults.push({
              name: attachment.name,
              status: "skipped",
              error: error.message || "Attachment download failed.",
            });
          }
        }
      }

      const warnings = [...(thread.warnings || [])];
      const skipped = attachmentResults.filter((item) => item.status !== "packed").length;
      if (skipped) warnings.push(`${skipped} attachment${skipped === 1 ? " was" : "s were"} skipped.`);
      const markdown = renderThreadMarkdown(thread, descriptor, attachmentResults, warnings);
      zip.addText(`${folder}/thread.md`, markdown);
      if (job.options.includeHtml) {
        zip.addText(`${folder}/thread.html`, renderThreadHtml(thread, descriptor, attachmentResults));
      }

      combinedSections.push(markdown);
      manifestThreads.push({
        index: index + 1,
        subject: thread.subject,
        gmailUrl: thread.url,
        folder,
        messageCount: thread.messages.length,
        attachmentCount: thread.attachments.length,
        attachments: attachmentResults,
        warnings,
        status: "exported",
      });
      exportedCount += 1;
      activity.done(
        `${thread.messages.length} message${thread.messages.length === 1 ? "" : "s"}, ${attachmentResults.filter((item) => item.status === "packed").length} file${attachmentResults.filter((item) => item.status === "packed").length === 1 ? "" : "s"} packed`,
      );
    } catch (error) {
      if (state.cancelled) throw error;
      errorCount += 1;
      const message = error.message || "Unknown extraction error.";
      const folder = `threads/${ordinal}-${sanitizeSegment(descriptor.subject, "no-subject")}`;
      const fallback = renderFailedThreadMarkdown(descriptor, message);
      zip.addText(`${folder}/thread.md`, fallback);
      combinedSections.push(fallback);
      manifestThreads.push({
        index: index + 1,
        subject: descriptor.subject,
        gmailUrl: descriptor.url,
        folder,
        status: "error",
        error: message,
      });
      activity.fail(message);
    } finally {
      await closeCurrentTab();
    }
  }

  if (state.cancelled) throw new Error("Export cancelled.");
  setStatus("Finalizing", "Writing the AI-ready index and ZIP…");
  setProgress(92);

  const generatedAt = new Date();
  zip.addText("all-context.md", combinedSections.join("\n\n---\n\n"));
  zip.addText("README.md", readmeText(job, exportedCount, errorCount));
  zip.addText(
    "manifest.json",
    JSON.stringify(
      {
        format: "mailpack-local",
        formatVersion: 1,
        generatedAt: generatedAt.toISOString(),
        source: "Gmail rendered conversation view",
        selectedConversationCount: job.items.length,
        exportedConversationCount: exportedCount,
        errorCount,
        messageCount: state.stats.messages,
        packedAttachmentCount: state.stats.files,
        packedAttachmentBytes: state.stats.attachmentBytes,
        options: job.options,
        threads: manifestThreads,
      },
      null,
      2,
    ),
  );

  state.zipBlob = zip.toBlob();
  const timestamp = generatedAt
    .toISOString()
    .slice(0, 16)
    .replace("T", "_")
    .replace(":", "-");
  state.zipFilename = `gmail-context-${timestamp}.zip`;
  setProgress(100);
  setStatus(
    errorCount ? "Finished with notes" : "Ready",
    errorCount
      ? `${exportedCount} exported, ${errorCount} need attention`
      : "Your private Gmail context ZIP is ready",
  );
  elements.title.textContent = "Your context is packed";
  elements.description.textContent =
    `${state.stats.messages} message${state.stats.messages === 1 ? "" : "s"} and ` +
    `${state.stats.files} attachment${state.stats.files === 1 ? "" : "s"} are ready for your local AI.`;
  document.body.classList.add("is-complete");
  elements.cancel.hidden = true;
  elements.downloadAgain.hidden = false;
  elements.downloads.hidden = false;

  await downloadZip(true);
}

async function initialize() {
  const jobId = new URLSearchParams(location.search).get("job");
  if (!jobId) {
    throw new Error("This export link is missing its job ID. Start again from Gmail.");
  }

  const storageKey = `mailpackJob:${jobId}`;
  const stored = await chrome.storage.session.get(storageKey);
  const job = stored[storageKey];
  if (!job?.items?.length) {
    throw new Error("This export job expired. Return to Gmail and start it again.");
  }
  await chrome.storage.session.remove(storageKey);
  return runExport(job);
}

function showFatalError(error) {
  setStatus(state.cancelled ? "Cancelled" : "Couldn’t finish", error.message || "Unexpected export error.");
  elements.title.textContent = state.cancelled ? "Export cancelled" : "The export stopped";
  elements.description.textContent = state.cancelled
    ? "No ZIP was downloaded. You can close this tab and start again from Gmail."
    : "Return to Gmail and try again. Any temporary Gmail tab has been closed.";
  elements.cancel.hidden = true;
  document.body.classList.add("is-error");
  addActivity(state.cancelled ? "Export cancelled" : "Export stopped", error.message || "",).fail(
    error.message || "Unknown error",
  );
}

elements.cancel.addEventListener("click", async () => {
  state.cancelled = true;
  elements.cancel.disabled = true;
  setStatus("Cancelling", "Closing the temporary Gmail tab…");
  await closeCurrentTab();
});

elements.downloadAgain.addEventListener("click", () => downloadZip(true));
elements.downloads.addEventListener("click", () => chrome.tabs.create({ url: "chrome://downloads/" }));

window.addEventListener("beforeunload", () => {
  if (state.currentTabId) chrome.tabs.remove(state.currentTabId).catch(() => {});
  if (state.zipUrl) URL.revokeObjectURL(state.zipUrl);
});

initialize().catch(async (error) => {
  await closeCurrentTab();
  showFatalError(error);
});
