const state = {
  tab: null,
  items: [],
  scanning: false,
};

const elements = {
  count: document.querySelector("#selectionCount"),
  title: document.querySelector("#selectionTitle"),
  hint: document.querySelector("#selectionHint"),
  preview: document.querySelector("#threadPreview"),
  refresh: document.querySelector("#refreshButton"),
  export: document.querySelector("#exportButton"),
  attachments: document.querySelector("#includeAttachments"),
  html: document.querySelector("#includeHtml"),
  notice: document.querySelector("#notice"),
  noticeText: document.querySelector("#noticeText"),
};

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function showNotice(message, isError = false) {
  elements.noticeText.textContent = message;
  elements.notice.hidden = false;
  elements.notice.classList.toggle("is-error", isError);
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.classList.remove("is-error");
}

function renderPreview(items) {
  elements.preview.replaceChildren();

  if (!items.length) {
    elements.preview.hidden = true;
    return;
  }

  for (const item of items.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "preview-item";
    const subject = document.createElement("span");
    subject.textContent = item.subject || "(No subject)";
    row.append(subject);
    elements.preview.append(row);
  }

  if (items.length > 3) {
    const more = document.createElement("p");
    more.className = "preview-more";
    more.textContent = `and ${items.length - 3} more`;
    elements.preview.append(more);
  }

  elements.preview.hidden = false;
}

function renderSelection() {
  const count = state.items.length;
  elements.count.textContent = String(count);
  elements.title.textContent = count
    ? `${count} ${pluralize(count, "conversation")} selected`
    : "No conversations selected";
  elements.hint.textContent = count
    ? "Ready to collect every rendered message in these threads."
    : "Check one or more rows in Gmail, then rescan.";
  elements.export.disabled = !count || state.scanning;
  renderPreview(state.items);
}

async function getActiveGmailTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://mail.google.com/")) {
    return null;
  }
  return tab;
}

async function sendToGmail(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function scanSelection() {
  if (state.scanning) return;

  state.scanning = true;
  state.items = [];
  elements.refresh.classList.add("is-loading");
  elements.export.disabled = true;
  elements.count.textContent = "–";
  elements.title.textContent = "Checking Gmail…";
  elements.hint.textContent = "Reading the conversations selected in this tab.";
  elements.preview.hidden = true;
  hideNotice();

  try {
    state.tab = await getActiveGmailTab();
    if (!state.tab) {
      elements.count.textContent = "0";
      elements.title.textContent = "Open Gmail first";
      elements.hint.textContent = "This extension works from a Gmail list or search results page.";
      showNotice("Switch to mail.google.com, select the messages you need, and open Mailpack again.");
      return;
    }

    const response = await sendToGmail(state.tab.id, { type: "MAILPACK_GET_SELECTION" });
    if (!response?.ok) {
      throw new Error(response?.error || "Gmail did not return a selection.");
    }

    state.items = response.items || [];
    renderSelection();

    if (response.checkedRows > 0 && state.items.length === 0) {
      showNotice("Gmail’s selected rows were found, but their conversation links were not readable. Try refreshing Gmail.", true);
    }
  } catch (error) {
    elements.count.textContent = "0";
    elements.title.textContent = "Couldn’t read this Gmail tab";
    elements.hint.textContent = "Refresh Gmail once after installing or reloading the extension.";
    showNotice(error.message || "Unexpected Gmail connection error.", true);
  } finally {
    state.scanning = false;
    elements.refresh.classList.remove("is-loading");
    elements.export.disabled = state.items.length === 0;
  }
}

async function startExport() {
  if (!state.tab?.id || !state.items.length) return;

  elements.export.disabled = true;
  const originalLabel = elements.export.querySelector("span").textContent;
  elements.export.querySelector("span").textContent = "Opening exporter…";

  try {
    const jobId = crypto.randomUUID();
    const storageKey = `mailpackJob:${jobId}`;
    await chrome.storage.session.set({
      [storageKey]: {
        id: jobId,
        sourceTabId: state.tab.id,
        createdAt: new Date().toISOString(),
        items: state.items,
        options: {
          includeAttachments: elements.attachments.checked,
          includeHtml: elements.html.checked,
        },
      },
    });

    await chrome.tabs.create({
      url: chrome.runtime.getURL(`export.html?job=${encodeURIComponent(jobId)}`),
      active: true,
      openerTabId: state.tab.id,
    });
    window.close();
  } catch (error) {
    showNotice(error.message || "Could not start the export.", true);
    elements.export.disabled = false;
    elements.export.querySelector("span").textContent = originalLabel;
  }
}

elements.refresh.addEventListener("click", scanSelection);
elements.export.addEventListener("click", startExport);
scanSelection();
