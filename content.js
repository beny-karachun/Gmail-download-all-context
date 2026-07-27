(() => {
  if (globalThis.__mailpackContentLoaded) return;
  globalThis.__mailpackContentLoaded = true;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function cleanInlineText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, " ")
      .trim();
  }

  function cleanBodyText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function absoluteGmailUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.href);
      return url.origin === location.origin ? url.href : "";
    } catch {
      return "";
    }
  }

  function extractThreadId(row, hrefs) {
    const direct =
      row.getAttribute("data-legacy-thread-id") ||
      row.getAttribute("data-thread-id") ||
      row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
      row.querySelector("[data-thread-id]")?.getAttribute("data-thread-id");
    if (direct) return direct;

    for (const href of hrefs) {
      const match = href.match(/[/=]([a-f0-9]{12,})(?:[/?&#]|$)/i);
      if (match) return match[1];
    }
    return "";
  }

  function getThreadUrl(row, threadId) {
    const candidates = [...row.querySelectorAll("a[href]")]
      .map((anchor) => absoluteGmailUrl(anchor.getAttribute("href")))
      .filter(Boolean);

    if (threadId) {
      const exact = candidates.find((href) => href.includes(threadId));
      if (exact) return exact;
    }

    const route = candidates.find((href) => {
      const hash = new URL(href).hash;
      return /#[^/]+\/[^/]+/.test(hash);
    });
    if (route) return route;

    if (threadId) {
      const base = `${location.origin}${location.pathname}${location.search}`;
      return `${base}#all/${threadId}`;
    }

    return "";
  }

  function getSelectedConversations() {
    const checkedRows = [...document.querySelectorAll("tr")].filter((row) =>
      row.querySelector('[role="checkbox"][aria-checked="true"]'),
    );
    const seen = new Set();
    const items = [];

    for (const row of checkedRows) {
      const hrefs = [...row.querySelectorAll("a[href]")]
        .map((anchor) => absoluteGmailUrl(anchor.getAttribute("href")))
        .filter(Boolean);
      const threadId = extractThreadId(row, hrefs);
      const url = getThreadUrl(row, threadId);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const subjectElement =
        row.querySelector(".bog") ||
        row.querySelector("[data-thread-subject]") ||
        row.querySelector('[role="link"] span');
      const senderElement =
        row.querySelector(".yW span[email]") ||
        row.querySelector(".bA4 span[email]") ||
        row.querySelector("span[email]");
      const dateElement =
        row.querySelector(".xW span[title]") ||
        row.querySelector("td.xW span") ||
        row.querySelector(".xW");
      const snippetElement = row.querySelector(".y2");

      items.push({
        threadId,
        url,
        subject: cleanInlineText(
          subjectElement?.getAttribute("data-thread-subject") || subjectElement?.textContent,
        ) || "(No subject)",
        sender: cleanInlineText(
          senderElement?.getAttribute("name") ||
          senderElement?.getAttribute("email") ||
          senderElement?.textContent,
        ),
        date: cleanInlineText(dateElement?.getAttribute("title") || dateElement?.textContent),
        snippet: cleanInlineText(snippetElement?.textContent),
      });
    }

    return { items, checkedRows: checkedRows.length };
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
  }

  async function waitForThread(expectedThreadId) {
    const timeoutAt = Date.now() + 18_000;
    while (Date.now() < timeoutAt) {
      const routeMatches = !expectedThreadId || location.href.includes(expectedThreadId);
      const hasThreadContent = document.querySelector(".hP, .a3s, [data-message-id]");
      if (routeMatches && hasThreadContent) return;
      await sleep(250);
    }
    throw new Error("The Gmail conversation did not finish loading.");
  }

  async function expandCollapsedMessages() {
    const main = document.querySelector('[role="main"]') || document.body;

    for (let pass = 0; pass < 3; pass += 1) {
      const candidates = [...main.querySelectorAll(".adn .kv, .adn .kQ, [data-message-id] .kv")]
        .filter(isVisible)
        .filter((element) => {
          const message = element.closest(".adn, [data-message-id]");
          return message && !message.querySelector(".a3s");
        })
        .slice(0, 80);

      if (!candidates.length) break;
      for (const element of candidates) element.click();
      await sleep(650);
    }
  }

  function readEmailAddress(element) {
    if (!element) return { name: "", email: "" };
    const name = cleanInlineText(element.getAttribute("name") || element.textContent);
    const email = cleanInlineText(
      element.getAttribute("email") ||
      element.getAttribute("data-hovercard-id") ||
      (element.getAttribute("title") || "").match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0],
    );
    return { name, email };
  }

  function sanitizeMessageHtml(bodyElement) {
    const clone = bodyElement.cloneNode(true);
    clone.querySelectorAll("script, style, iframe, object, embed, form, input, button").forEach((element) => {
      element.remove();
    });

    clone.querySelectorAll("img").forEach((image) => {
      const replacement = document.createElement("span");
      const alt = cleanInlineText(image.getAttribute("alt"));
      replacement.textContent = alt ? `[Image: ${alt}]` : "[Inline image]";
      image.replaceWith(replacement);
    });

    const allowedAttributes = new Set(["href", "title", "alt", "colspan", "rowspan"]);
    clone.querySelectorAll("*").forEach((element) => {
      for (const attribute of [...element.attributes]) {
        if (!allowedAttributes.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      }

      if (element.tagName === "A") {
        const href = element.getAttribute("href") || "";
        if (!/^(https?:|mailto:)/i.test(href)) element.removeAttribute("href");
        element.removeAttribute("target");
      }
    });

    return clone.innerHTML.trim();
  }

  function extractLinks(bodyElement) {
    const seen = new Set();
    const links = [];

    for (const anchor of bodyElement.querySelectorAll("a[href]")) {
      const href = anchor.href;
      if (!/^(https?:|mailto:)/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      links.push({
        text: cleanInlineText(anchor.textContent) || href,
        url: href,
      });
    }

    return links.slice(0, 250);
  }

  function parseDownloadAttribute(value) {
    const markerIndex = value.search(/:https?:\/\//i);
    if (markerIndex < 0) return null;

    const prefix = value.slice(0, markerIndex);
    const url = value.slice(markerIndex + 1);
    const firstColon = prefix.indexOf(":");
    return {
      mime: firstColon >= 0 ? prefix.slice(0, firstColon) : "",
      name: firstColon >= 0 ? prefix.slice(firstColon + 1) : prefix,
      url,
    };
  }

  function attachmentName(element, fallbackIndex) {
    const scope = element.closest(".aQH, .aZo, .aQw, [data-attachment-id]") || element.parentElement;
    const candidate =
      element.getAttribute("download") ||
      element.getAttribute("data-tooltip") ||
      element.getAttribute("title") ||
      scope?.querySelector(".aV3, .aQy, [data-tooltip]")?.getAttribute("data-tooltip") ||
      scope?.querySelector(".aV3, .aQy")?.textContent ||
      element.textContent;
    return cleanInlineText(candidate) || `attachment-${fallbackIndex}`;
  }

  function discoverAttachments(main) {
    const attachments = [];
    const seen = new Set();

    for (const element of main.querySelectorAll("[download_url]")) {
      const parsed = parseDownloadAttribute(element.getAttribute("download_url") || "");
      if (!parsed?.url || seen.has(parsed.url)) continue;
      seen.add(parsed.url);
      attachments.push({
        name: cleanInlineText(parsed.name) || attachmentName(element, attachments.length + 1),
        mime: cleanInlineText(parsed.mime),
        url: parsed.url,
        sizeText: cleanInlineText(
          element.closest(".aQH, .aZo, .aQw")?.querySelector(".SaH2Ve, .aV4")?.textContent,
        ),
      });
    }

    const attachmentLinks = main.querySelectorAll(
      'a[href*="view=att"], a[href*="disp=safe"], a[href*="attid="]',
    );
    for (const anchor of attachmentLinks) {
      const url = absoluteGmailUrl(anchor.getAttribute("href"));
      if (!url || seen.has(url)) continue;
      seen.add(url);
      attachments.push({
        name: attachmentName(anchor, attachments.length + 1),
        mime: cleanInlineText(anchor.getAttribute("type")),
        url,
        sizeText: cleanInlineText(
          anchor.closest(".aQH, .aZo, .aQw")?.querySelector(".SaH2Ve, .aV4")?.textContent,
        ),
      });
    }

    return attachments;
  }

  function extractMessages(main) {
    const bodyElements = [...main.querySelectorAll(".a3s")]
      .filter((element) => !element.parentElement?.closest(".a3s"));
    const messages = [];

    for (const bodyElement of bodyElements) {
      const container =
        bodyElement.closest(".adn") ||
        bodyElement.closest("[data-message-id]") ||
        bodyElement.parentElement;
      if (!container) continue;

      const senderElement =
        container.querySelector(".gD[email], .gD, [data-hovercard-id][email]") ||
        container.querySelector("[email]");
      const sender = readEmailAddress(senderElement);
      const recipientElement = container.querySelector(".g2");
      const dateElement = container.querySelector(".g3[title], .g3");
      const idElement = container.closest("[data-message-id]") || container.querySelector("[data-message-id]");
      const text = cleanBodyText(bodyElement.innerText || bodyElement.textContent);

      messages.push({
        id: cleanInlineText(idElement?.getAttribute("data-message-id")),
        fromName: sender.name,
        fromEmail: sender.email,
        to: cleanInlineText(recipientElement?.getAttribute("title") || recipientElement?.textContent),
        date: cleanInlineText(dateElement?.getAttribute("title") || dateElement?.textContent),
        text: text || "(Message body was empty or not rendered.)",
        html: sanitizeMessageHtml(bodyElement),
        links: extractLinks(bodyElement),
      });
    }

    return messages;
  }

  async function extractThread(expectedThreadId) {
    await waitForThread(expectedThreadId);
    await expandCollapsedMessages();

    const main = document.querySelector('[role="main"]') || document.body;
    const subject =
      cleanInlineText(document.querySelector(".hP")?.textContent) ||
      cleanInlineText(document.title.replace(/\s*-\s*Gmail\s*$/i, "")) ||
      "(No subject)";
    const messages = extractMessages(main);
    const attachments = discoverAttachments(main);

    return {
      subject,
      url: location.href,
      messages,
      attachments,
      warnings: messages.length
        ? []
        : ["No rendered message bodies were found. Gmail may have changed its page structure."],
    };
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 32_768;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function fetchAttachment(url, maxBytes) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url, location.href);
    } catch {
      throw new Error("The attachment URL was invalid.");
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Only secure attachment URLs are supported.");
    }

    const response = await fetch(parsedUrl.href, {
      credentials: "include",
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Gmail returned HTTP ${response.status}.`);
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > maxBytes) {
      throw new Error(`Attachment is larger than ${Math.round(maxBytes / 1_000_000)} MB.`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Attachment is larger than ${Math.round(maxBytes / 1_000_000)} MB.`);
    }

    return {
      base64: bytesToBase64(new Uint8Array(buffer)),
      bytes: buffer.byteLength,
      mime: response.headers.get("content-type") || "",
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === "MAILPACK_GET_SELECTION") {
      try {
        sendResponse({ ok: true, ...getSelectedConversations() });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Could not inspect Gmail." });
      }
      return false;
    }

    if (request?.type === "MAILPACK_EXTRACT_THREAD") {
      extractThread(request.threadId)
        .then((thread) => sendResponse({ ok: true, thread }))
        .catch((error) =>
          sendResponse({ ok: false, error: error.message || "Could not extract the conversation." }),
        );
      return true;
    }

    if (request?.type === "MAILPACK_FETCH_ATTACHMENT") {
      fetchAttachment(request.url, request.maxBytes)
        .then((attachment) => sendResponse({ ok: true, attachment }))
        .catch((error) =>
          sendResponse({ ok: false, error: error.message || "Could not download the attachment." }),
        );
      return true;
    }

    return false;
  });
})();
