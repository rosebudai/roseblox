import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Packages the character-controls bundle that every new 3D game receives as /rosie/roseblox.js.
const gateway = process.argv[2];
if (!gateway) throw new Error("Usage: node scripts/sync-playground.mjs /workspace/PlaygroundGatewayV2");
const root = fileURLToPath(new URL("../build/", import.meta.url));
const built = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const sources = { "roseblox.js": "controls.js", "README.md": "CONTROLS.md" };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema_version: 1, profile: "character_controls",
  source_revision: built.source_revision, source_dirty: built.source_dirty,
  version: built.version, dependencies: built.dependencies, files: {},
};
const contents = {};
for (const [name, source] of Object.entries(sources)) {
  const bytes = await readFile(join(root, source));
  if (sha(bytes) !== built.files[source]?.sha256) throw new Error(`Stale build: ${source}`);
  contents[name] = bytes;
  manifest.files[name] = { sha256: sha(bytes), bytes: bytes.length };
}
const destination = join(resolve(gateway), "playground_gateway/core/services/chat/components/roseblox");
await mkdir(destination, { recursive: true });
for (const [name, bytes] of Object.entries(contents)) await writeFile(join(destination, name), bytes);
await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synced verified character controls to ${destination}`);
