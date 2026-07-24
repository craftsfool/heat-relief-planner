import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXED_SERVICE_RADIUS,
  MAP_SUBZONES,
  STATION_CAPACITIES,
  getDemandState,
  getStationCost,
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
  const task = createSolverTask(config);
  const candidateById = new Map(task.candidates.map((candidate) => [candidate.id, candidate]));
  const demandState = getDemandState(task.cells, record.solution);
  const reversedDemandState = getDemandState(task.cells, [...record.solution].reverse());
  const spent = record.solution.reduce((sum, station) => sum + station.cost, 0);
  assert.equal(Math.round(demandState.servedByPlaced), record.stats.population);
  assert.equal(Math.round(reversedDemandState.servedByPlaced), record.stats.population);
  assert.equal(spent, record.stats.spent);
  assert.ok(spent <= STANDARD_BUDGET);
  for (const station of record.solution) {
    assert.equal(station.radius, FIXED_SERVICE_RADIUS);
    assert.equal(STATION_CAPACITIES.includes(station.capacity), true);
    assert.equal(station.cost, getStationCost(candidateById.get(station.id), station.capacity));
    assert.ok((demandState.perStation.get(station.id) ?? 0) <= station.capacity + 1e-6);
  }
  for (let index = 0; index < demandState.servedByCell.length; index += 1) {
    assert.equal(
      demandState.servedByCell[index] <= demandState.afterExisting[index] + 1e-6,
      true,
    );
  }
  verified += 1;
}

const referenceSite = { housingCostIndex: 1 };
const referenceCosts = STATION_CAPACITIES.map((capacity) =>
  getStationCost(referenceSite, capacity));
const marginalCosts = referenceCosts.slice(1).map((cost, index) =>
  cost - referenceCosts[index]);
for (let index = 1; index < marginalCosts.length; index += 1) {
  assert.ok(
    marginalCosts[index] >= marginalCosts[index - 1],
    "Station capacity cost must remain convex.",
  );
}

assert.equal(verified, scopes.length);
console.log(`Verified ${verified} Queenstown and subzone solution cache files.`);
