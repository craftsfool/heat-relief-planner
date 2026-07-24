import assert from "node:assert/strict";
import { solveExactOptimal } from "../src/model/exactOptimalCore.js";

const EPSILON = 1e-8;
const RADII = [20, 40, 60];
const CAPACITIES = { 20: 20, 40: 45, 60: 80 };
const BASE_COSTS = { 20: 90_000, 40: 130_000, 60: 180_000 };
const BUDGET = 390_000;

const stationCost = (candidate, radius) =>
  Math.round((BASE_COSTS[radius] * candidate.housingCostIndex) / 1000) * 1000;

const evaluate = (selection, demandCells, columns, rows) => {
  const residual = new Float64Array(columns * rows);
  const scores = new Float64Array(columns * rows);
  for (const cell of demandCells) {
    const index = cell.y * columns + cell.x;
    residual[index] = cell.population;
    scores[index] = cell.score;
  }
  let score = 0;
  let population = 0;
  for (const station of selection) {
    let capacity = CAPACITIES[station.radius];
    const reach = station.radius / 20;
    for (let ring = 0; ring <= reach && capacity > EPSILON; ring += 1) {
      const cells = [];
      let ringDemand = 0;
      for (let offsetY = -ring; offsetY <= ring; offsetY += 1) {
        for (let offsetX = -ring; offsetX <= ring; offsetX += 1) {
          if (Math.abs(offsetX) + Math.abs(offsetY) !== ring) continue;
          const x = station.x + offsetX;
          const y = station.y + offsetY;
          if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
          const index = y * columns + x;
          if (residual[index] <= 0) continue;
          cells.push({ index, demand: residual[index] });
          ringDemand += residual[index];
        }
      }
      if (ringDemand <= 0) continue;
      const served = Math.min(capacity, ringDemand);
      const ratio = served / ringDemand;
      for (const cell of cells) {
        const amount = cell.demand * ratio;
        residual[cell.index] -= amount;
        score += amount * scores[cell.index] / 100;
      }
      population += served;
      capacity -= served;
    }
  }
  return {
    score,
    population,
    spent: selection.reduce((sum, station) => sum + station.cost, 0),
  };
};

const isBetter = (candidate, incumbent) => (
  candidate.score > incumbent.score + EPSILON
  || (
    Math.abs(candidate.score - incumbent.score) <= EPSILON
    && (
      candidate.population > incumbent.population + EPSILON
      || (
        Math.abs(candidate.population - incumbent.population) <= EPSILON
        && candidate.spent < incumbent.spent
      )
    )
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
    for (const radius of RADII) {
      const candidate = candidates[index];
      const cost = stationCost(candidate, radius);
      if (spent + cost > BUDGET) continue;
      selection.push({
        ...candidate,
        radius,
        capacity: CAPACITIES[radius],
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
    radii: RADII,
    capacities: CAPACITIES,
    baseCosts: BASE_COSTS,
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

console.log("Capacity-aware exact solver matches brute force on 5 deterministic overlap cases.");
