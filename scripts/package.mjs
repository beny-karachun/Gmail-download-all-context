import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
await import(new URL("zip.js", root));

const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const files = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "content.js",
  "export.html",
  "export.css",
  "export.js",
  "zip.js",
  "README.md",
  "PRIVACY.md",
  "icons/icon.svg",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

const zip = new globalThis.MailpackZip();
for (const path of files) {
  zip.addBytes(path, new Uint8Array(await readFile(new URL(path, root))));
}

const outputDirectory = new URL("dist/", root);
const output = new URL(`mailpack-local-v${manifest.version}.zip`, outputDirectory);
await mkdir(outputDirectory, { recursive: true });
await writeFile(output, new Uint8Array(await zip.toBlob().arrayBuffer()));
console.log(fileURLToPath(output));
