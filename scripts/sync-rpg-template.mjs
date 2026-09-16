import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const gateway = process.argv[2];
if (!gateway) throw new Error("Usage: node scripts/sync-rpg-template.mjs /workspace/PlaygroundGatewayV2");
const root = fileURLToPath(new URL("../", import.meta.url));
const build = JSON.parse(await readFile(join(root, "build/manifest.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const files = {};
for (const [source, name] of [["rpgTemplate.js", "runtime.js"], ["RPG_TEMPLATE.md", "README.md"]]) {
  const bytes = await readFile(join(root, "build", source));
  if (hash(bytes) !== build.files[source]?.sha256) throw new Error(`Stale template build: ${source}`);
  files[name] = bytes;
}
for (const name of ["main.js", "assets.js", "world.js", "content.js", "theme.css"]) files[name] = await readFile(join(root, "templates/rpg", name));
const paths = { "runtime.js": "/rosie/rpg/runtime.js", "README.md": "/rosie/README.md", "main.js": "/main.js", "assets.js": "/game/assets.js", "world.js": "/game/world.js", "content.js": "/game/content.js", "theme.css": "/game/theme.css" };
const manifest = { schema_version: 1, profile: "open_world_rpg", version: "0.1.0-experiment", control_profile: "wow_classic_desktop", source_revision: build.source_revision, source_dirty: build.source_dirty, files: {} };
const target = join(resolve(gateway), "playground_gateway/core/services/chat/components/rpg_template");
await mkdir(target, { recursive: true });
for (const [name, bytes] of Object.entries(files)) {
  manifest.files[name] = { path: paths[name], sha256: hash(bytes), bytes: bytes.length, visible: name !== "runtime.js", managed: ["runtime.js", "README.md", "main.js"].includes(name) };
  await writeFile(join(target, name), bytes);
}
await writeFile(join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Packaged verified RPG template at ${target}`);
