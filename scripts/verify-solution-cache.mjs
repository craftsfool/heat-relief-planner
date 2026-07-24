import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_SUBZONES } from "../src/model/cityModel.js";
import {
  STANDARD_BUDGET,
  getSolverKey,
  validateSolutionRecord,
} from "../src/model/solverTask.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scopes = [null, ...MAP_SUBZONES.map((subzone) => subzone.code)];
let verified = 0;

for (const subzoneCode of scopes) {
  const config = {
    subzoneCode,
    budget: STANDARD_BUDGET,
  };
  const cachePath = path.join(
    root,
    "public",
    "solutions",
    `${getSolverKey(config)}.json`,
  );
  const record = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(
    validateSolutionRecord(record, config),
    true,
    `Invalid solution cache: ${cachePath}`,
  );
  verified += 1;
}

assert.equal(verified, scopes.length);
console.log(`Verified ${verified} Queenstown and subzone solution cache files.`);
