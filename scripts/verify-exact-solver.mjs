import assert from "node:assert/strict";
import { solveExactOptimal } from "../src/model/exactOptimalCore.js";

const EPSILON = 1e-8;
const SERVICE_RADIUS = 60;
const CAPACITY_OPTIONS = [20, 45, 80];
const COST_MODEL = {
  fixed: 60_000,
  linear: 1_000,
  quadratic: 10,
  minimumRegionalMultiplier: 0.7,
  maximumRegionalMultiplier: 1.3,
};
const BUDGET = 390_000;

const stationCost = (candidate, capacity) => {
  const regionalMultiplier = Math.min(
    COST_MODEL.maximumRegionalMultiplier,
    Math.max(COST_MODEL.minimumRegionalMultiplier, candidate.housingCostIndex),
  );
  const baseCost = COST_MODEL.fixed
    + COST_MODEL.linear * capacity
    + COST_MODEL.quadratic * capacity ** 2;
  return Math.round((baseCost * regionalMultiplier) / 1000) * 1000;
};

const evaluate = (selection, demandCells, columns, rows) => {
  const residual = new Float64Array(columns * rows);
  for (const cell of demandCells) {
    const index = cell.y * columns + cell.x;
    residual[index] = cell.population;
  }
  let population = 0;
  for (const station of selection) {
    let capacity = station.capacity;
    const reach = Math.ceil(SERVICE_RADIUS / 20);
    const maximumDistanceSquared = (SERVICE_RADIUS / 20) ** 2;
    const offsetsByDistance = new Map();
    for (let offsetY = -reach; offsetY <= reach; offsetY += 1) {
      for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
        const distanceSquared = offsetX ** 2 + offsetY ** 2;
        if (distanceSquared > maximumDistanceSquared) continue;
        const offsets = offsetsByDistance.get(distanceSquared) ?? [];
        offsets.push({ offsetX, offsetY });
        offsetsByDistance.set(distanceSquared, offsets);
      }
    }
    const bands = [...offsetsByDistance.entries()]
      .sort(([distanceA], [distanceB]) => distanceA - distanceB)
      .map(([, offsets]) => offsets);
    for (const band of bands) {
      const cells = [];
      for (const { offsetX, offsetY } of band) {
          const x = station.x + offsetX;
          const y = station.y + offsetY;
          if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
          const index = y * columns + x;
          if (residual[index] <= 0) continue;
          cells.push({
            index,
            demand: residual[index],
          });
      }
      cells.sort((a, b) => a.index - b.index);
      for (const cell of cells) {
        const amount = Math.min(cell.demand, capacity);
        residual[cell.index] -= amount;
        population += amount;
        capacity -= amount;
        if (capacity <= EPSILON) break;
      }
      if (capacity <= EPSILON) break;
    }
  }
  return {
    score: population,
    population,
    spent: selection.reduce((sum, station) => sum + station.cost, 0),
  };
};

const isBetter = (candidate, incumbent) => (
  candidate.population > incumbent.population + EPSILON
  || (
    Math.abs(candidate.population - incumbent.population) <= EPSILON
    && candidate.spent < incumbent.spent
  )
);

const bruteForce = (candidates, demandCells, columns, rows) => {
  let best = { score: 0, population: 0, spent: 0, selection: [] };
  const selection = [];
  const visit = (index, spent) => {
    if (index === candidates.length) {
      const result = evaluate(selection, demandCells, columns, rows);
      if (isBetter(result, best)) best = { ...result, selection: [...selection] };
      return;
    }
    visit(index + 1, spent);
    for (const capacity of CAPACITY_OPTIONS) {
      const candidate = candidates[index];
      const cost = stationCost(candidate, capacity);
      if (spent + cost > BUDGET) continue;
      selection.push({
        ...candidate,
        radius: SERVICE_RADIUS,
        capacity,
        cost,
      });
      visit(index + 1, spent + cost);
      selection.pop();
    }
  };
  visit(0, 0);
  return best;
};

const makeCase = (seed) => {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const columns = 12;
  const rows = 10;
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    id: `candidate-${index}`,
    x: 1 + Math.floor(random() * (columns - 2)),
    y: 1 + Math.floor(random() * (rows - 2)),
    housingCostIndex: 0.7 + random() * 0.6,
  }));
  const demandCells = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (random() < 0.12) continue;
      demandCells.push({
        x,
        y,
        score: Math.round(random() * 80),
        heat: random(),
        population: Math.round(random() * 35),
      });
    }
  }
  return { columns, rows, candidates, demandCells };
};

for (const seed of [7, 19, 41, 83, 131]) {
  const testCase = makeCase(seed);
  const exact = solveExactOptimal({
    ...testCase,
    budget: BUDGET,
    serviceRadius: SERVICE_RADIUS,
    capacityOptions: CAPACITY_OPTIONS,
    costModel: COST_MODEL,
  });
  const brute = bruteForce(
    testCase.candidates,
    testCase.demandCells,
    testCase.columns,
    testCase.rows,
  );
  const exactResult = evaluate(
    exact.solution,
    testCase.demandCells,
    testCase.columns,
    testCase.rows,
  );

  assert.equal(exact.stats.optimal, true);
  assert.ok(Math.abs(exactResult.score - brute.score) <= EPSILON, `score mismatch for seed ${seed}`);
  assert.ok(
    Math.abs(exactResult.population - brute.population) <= EPSILON,
    `population mismatch for seed ${seed}`,
  );
  assert.equal(exactResult.spent, brute.spent, `cost mismatch for seed ${seed}`);
}

console.log("Euclidean distance-only exact solver matches brute force on 5 deterministic overlap cases.");
