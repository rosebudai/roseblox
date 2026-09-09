import { readFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const gateway = process.argv[2];
if (!gateway) throw new Error("Usage: node scripts/sync-playground.mjs /workspace/PlaygroundGatewayV2");
const root = fileURLToPath(new URL("../build/", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
for (const name of ["roseblox.js", "README.md"]) {
  const bytes = await readFile(join(root, name));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.files[name]?.sha256) throw new Error(`Stale build: ${name}`);
}
const destination = join(resolve(gateway), "playground_gateway/core/services/chat/components/roseblox");
await mkdir(destination, { recursive: true });
for (const name of ["roseblox.js", "README.md", "manifest.json"]) await copyFile(join(root, name), join(destination, name));
console.log(`Synced verified Roseblox build to ${destination}`);
