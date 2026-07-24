import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_COST_BY_RADIUS,
  MAP_SUBZONES,
  STATION_CAPACITY_BY_RADIUS,
  STATION_RADII,
  getDemandState,
} from "../src/model/cityModel.js";
import {
  STANDARD_BUDGET,
  createSolverTask,
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
  if (!subzoneCode) {
    const task = createSolverTask(config);
    const demandState = getDemandState(task.cells, record.solution);
    const reversedDemandState = getDemandState(task.cells, [...record.solution].reverse());
    const spent = record.solution.reduce((sum, station) => sum + station.cost, 0);
    assert.equal(Math.round(demandState.servedByPlaced), 36_000);
    assert.equal(Math.round(reversedDemandState.servedByPlaced), 36_000);
    assert.equal(
      [...demandState.perStation.values()].every((served) => Math.abs(served - 4_500) < 1e-6),
      true,
    );
    for (let index = 0; index < demandState.servedByCell.length; index += 1) {
      assert.equal(
        demandState.servedByCell[index] <= demandState.afterExisting[index] + 1e-6,
        true,
      );
    }
    assert.equal(spent, 2_499_000);

    const minimumCostByRadius = Object.fromEntries(STATION_RADII.map((radius) => [
      radius,
      Math.min(...task.candidates.map((candidate) =>
        Math.round((BASE_COST_BY_RADIUS[radius] * candidate.housingCostIndex) / 1000) * 1000)),
    ]));
    const capacityUpper = new Int32Array(STANDARD_BUDGET / 1000 + 1);
    for (let budgetUnits = 0; budgetUnits < capacityUpper.length; budgetUnits += 1) {
      for (const radius of STATION_RADII) {
        const costUnits = minimumCostByRadius[radius] / 1000;
        if (costUnits > budgetUnits) continue;
        capacityUpper[budgetUnits] = Math.max(
          capacityUpper[budgetUnits],
          capacityUpper[budgetUnits - costUnits] + STATION_CAPACITY_BY_RADIUS[radius],
        );
      }
    }
    assert.equal(Math.max(...capacityUpper), 36_000);
    assert.equal(record.stats.capacityUpperBound, 36_000);
  }
  verified += 1;
}

assert.equal(verified, scopes.length);
console.log(`Verified ${verified} Queenstown and subzone solution cache files.`);
