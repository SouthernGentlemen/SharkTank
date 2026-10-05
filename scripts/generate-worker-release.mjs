import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = process.env.WG_VERSION ?? manifest.version;
const commit = process.env.WG_COMMIT ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error("Worker release requires a semantic version and full commit");
}
if ((process.env.WG_VERSION === undefined) !== (process.env.WG_COMMIT === undefined)) {
  throw new Error("Worker release version and commit must be supplied together");
}
writeFileSync(new URL("../src/worker/release.generated.ts", import.meta.url),
  `// Generated from the exact source build; do not edit.\nexport const version = ${JSON.stringify(version)};\nexport const commit = ${JSON.stringify(commit)};\n`);
