import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solveGlobalConfiguration } from "../src/model/globalSolverCore.js";
import {
  getSolverKey,
  normalizeSolverConfig,
} from "../src/model/solverTask.js";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/, "").split("=");
  return [key, parts.join("=")];
}));
const config = normalizeSolverConfig({
  scenario: args.scenario,
  time: args.time,
  subzoneCode: args.subzone || null,
  budget: args.budget,
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public", "solutions", `${getSolverKey(config)}.json`);

const startedAt = Date.now();
console.log(`Solving ${getSolverKey(config)}`);
const record = solveGlobalConfiguration(config, {
  source: "github-actions",
  refinementLimit: Number(args.refinement) || 24,
  onProgress: (progress) => {
    if (progress.phase === "exact" && progress.nodes % 100_000 === 0) {
      console.log(JSON.stringify(progress));
    }
  },
});
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record)}\n`);
console.log(`Wrote ${outputPath} in ${Date.now() - startedAt} ms`);
