import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_SUBZONES } from "../src/model/cityModel.js";
import { solveGlobalConfiguration } from "../src/model/globalSolverCore.js";
import {
  getSolverKey,
  normalizeSolverConfig,
} from "../src/model/solverTask.js";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/, "").split("=");
  return [key, parts.join("=")];
}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scopes = Object.hasOwn(args, "all-scopes")
  ? [null, ...MAP_SUBZONES.map((subzone) => subzone.code)]
  : [args.subzone || null];

const startedAt = Date.now();
for (const subzoneCode of scopes) {
  const config = normalizeSolverConfig({
    subzoneCode,
    budget: args.budget,
  });
  const outputPath = path.join(root, "public", "solutions", `${getSolverKey(config)}.json`);
  const refinementLimit = Number(args.refinement) > 0
    ? Number(args.refinement)
    : subzoneCode
      ? 7
      : 16;

  console.log(`Solving ${getSolverKey(config)}`);
  const record = solveGlobalConfiguration(config, {
    source: "github-actions-refined",
    refinementLimit,
    onProgress: (progress) => {
      if (progress.phase === "exact" && progress.nodes % 100_000 === 0) {
        console.log(JSON.stringify(progress));
      }
    },
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record)}\n`);
}
console.log(`Wrote ${scopes.length} solution cache files in ${Date.now() - startedAt} ms`);
