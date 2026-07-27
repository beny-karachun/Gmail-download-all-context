import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const scripts = ["popup.js", "content.js", "zip.js", "export.js"];

for (const script of scripts) {
  execFileSync(process.execPath, ["--check", fileURLToPath(new URL(script, root))], {
    stdio: "inherit",
  });
}

const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.content_scripts[0].matches[0], "https://mail.google.com/*");
assert.ok(manifest.permissions.includes("downloads"));
assert.ok(manifest.host_permissions.includes("https://mail.google.com/*"));

await import(new URL("zip.js", root));
const zip = new globalThis.MailpackZip();
zip.addText("README.md", "hello\n");
zip.addText("threads/001/thread.md", "# Test\n");
const bytes = new Uint8Array(await zip.toBlob().arrayBuffer());
const view = new DataView(bytes.buffer);

assert.equal(view.getUint32(0, true), 0x04034b50, "ZIP starts with a local file header");
assert.equal(
  view.getUint32(bytes.length - 22, true),
  0x06054b50,
  "ZIP ends with the central directory record",
);
assert.equal(view.getUint16(bytes.length - 12, true), 2, "ZIP indexes both test entries");

console.log("Mailpack validation passed.");
