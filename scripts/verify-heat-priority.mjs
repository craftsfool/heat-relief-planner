import assert from "node:assert/strict";
import { solveGreedyLocal } from "../src/model/greedyLocalCore.js";
import { allocatePopulationToStations } from "../src/model/populationAllocation.js";

const residual = new Float64Array(9);
residual[3] = 50;
residual[5] = 50;
const available = new Uint8Array(9);
available[3] = 1;
available[5] = 1;
const allocation = allocatePopulationToStations({
  stations: [{ id: "station", x: 1, y: 1, radius: 20, capacity: 50 }],
  residual,
  available,
  columns: 3,
  rows: 3,
  getDistanceBands: () => [[{ x: -1, y: 0 }, { x: 1, y: 0 }]],
  stationCapacity: (station) => station.capacity,
});

assert.equal(allocation.served, 50);
assert.equal(residual[3], 0);
assert.equal(residual[5], 50);

const solveTwoSiteCase = (hotPopulation) => solveGreedyLocal({
  candidates: [
    { id: "cold-efficient", x: 1, y: 0, housingCostIndex: 1, score: 1 },
    { id: "hot-near-equal", x: 5, y: 0, housingCostIndex: 1, score: 1 },
  ],
  demandCells: [
    { x: 1, y: 0, heat: 0.1, population: 100 },
    { x: 5, y: 0, heat: 0.9, population: hotPopulation },
  ],
  budget: 100_000,
  columns: 7,
  rows: 1,
  serviceRadius: 0,
  capacityOptions: [100],
  costModel: {
    fixed: 100_000,
    linear: 0,
    quadratic: 0,
    minimumRegionalMultiplier: 1,
    maximumRegionalMultiplier: 1,
  },
  greedyOnly: true,
}).solution[0].id;

assert.equal(solveTwoSiteCase(96), "hot-near-equal");
assert.equal(solveTwoSiteCase(94), "cold-efficient");

console.log("Verified distance-only service and the 95% efficiency heat-priority rule.");
