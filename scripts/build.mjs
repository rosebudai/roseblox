import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
await mkdir(`${root}/build`, { recursive: true });
for (const name of ["roseblox", "mechanics", "visuals", "rpg"]) {
  await build({
    absWorkingDir: root,
    entryPoints: [name === "roseblox" ? "src/index.js" : `src/${name}.js`],
    bundle: true, format: "esm", target: "es2022", outfile: `build/${name}.js`,
    external: ["three", "three/*"],
    plugins: [{
      name: "pinned-browser-physics",
      setup(builder) {
        // Keep Rapier's WASM external and use one Three.js instance per game.
        builder.onResolve({ filter: /^@dimforge\/rapier3d-compat$/ }, () => ({
          path: `https://esm.sh/@dimforge/rapier3d-compat@${packageJson.devDependencies["@dimforge/rapier3d-compat"]}`,
          external: true,
        }));
      },
    }],
  });
}
await copyFile(`${root}/build/roseblox.js`, `${root}/build/roseblox-game-engine.js`);
const guide = await readFile(`${root}/docs/ROSEBLOX.md`);
await writeFile(`${root}/build/README.md`, guide);
await copyFile(`${root}/docs/MECHANICS.md`, `${root}/build/MECHANICS.md`);
await copyFile(`${root}/docs/RPG.md`, `${root}/build/RPG.md`);
const sha = process.env.ROSEBLOX_SOURCE_REVISION ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Source revision must be a full Git SHA");
const dirty = process.env.ROSEBLOX_SOURCE_REVISION ? true : execFileSync("git", ["status", "--porcelain", "--", "src", "scripts/build.mjs", "package.json", "package-lock.json", "docs/ROSEBLOX.md", "docs/MECHANICS.md", "docs/RPG.md"], { cwd: root, encoding: "utf8" }).trim().length > 0;
const manifest = {
  schema_version: 1,
  source_revision: sha,
  source_dirty: dirty,
  version: packageJson.version,
  dependencies: Object.fromEntries(["three", "@dimforge/rapier3d-compat", "miniplex", "camera-controls"].map(name => [name, packageJson.devDependencies[name]])),
  files: {},
};
for (const name of ["roseblox.js", "README.md", "mechanics.js", "visuals.js", "MECHANICS.md", "rpg.js", "RPG.md"]) {
  const bytes = await readFile(`${root}/build/${name}`);
  manifest.files[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
await writeFile(`${root}/build/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
