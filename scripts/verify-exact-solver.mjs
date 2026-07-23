import assert from "node:assert/strict";
import { solveExactOptimal } from "../src/model/exactOptimalCore.js";

const CELL_HALF_DIAGONAL = Math.SQRT2 / 2;
const EPSILON = 1e-8;
const RADII = [20, 40, 60];
const SCORE_REDUCTION = 30;
const BUDGET = 720_000;

const stationCost = (candidate, radius) => {
  const landFactor = 0.45 + 0.55 * candidate.flow;
  return Math.round((160000 + radius * 650 + landFactor * 85000) / 1000) * 1000;
};

const coverageAt = (candidate, radius, cell) => {
  const distance = Math.max(
    0,
    Math.hypot(candidate.x - cell.x, candidate.y - cell.y) - CELL_HALF_DIAGONAL,
  );
  return Math.max(0, 1 - distance / (radius / 20));
};

const evaluate = (selection, demandCells) => {
  let score = 0;
  let population = 0;
  for (const cell of demandCells) {
    let coverage = 0;
    for (const station of selection) {
      coverage = Math.max(coverage, coverageAt(station, station.radius, cell));
    }
    score += Math.min(cell.score, SCORE_REDUCTION * coverage);
    population += cell.population * coverage;
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

const bruteForce = (candidates, demandCells) => {
  let best = { score: 0, population: 0, spent: 0, selection: [] };
  const selection = [];

  const visit = (index, spent) => {
    if (index === candidates.length) {
      const result = evaluate(selection, demandCells);
      if (isBetter(result, best)) best = { ...result, selection: [...selection] };
      return;
    }

    visit(index + 1, spent);
    for (const radius of RADII) {
      const candidate = candidates[index];
      const cost = stationCost(candidate, radius);
      if (spent + cost > BUDGET) continue;
      selection.push({ ...candidate, radius, cost });
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
    flow: 0.1 + random() * 0.9,
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
    scoreReduction: SCORE_REDUCTION,
  });
  const brute = bruteForce(testCase.candidates, testCase.demandCells);
  const exactResult = evaluate(exact.solution, testCase.demandCells);

  assert.equal(exact.stats.optimal, true);
  assert.ok(Math.abs(exactResult.score - brute.score) <= EPSILON, `score mismatch for seed ${seed}`);
  assert.ok(
    Math.abs(exactResult.population - brute.population) <= EPSILON,
    `population mismatch for seed ${seed}`,
  );
  assert.equal(exactResult.spent, brute.spent, `cost mismatch for seed ${seed}`);
}

console.log("Exact solver matches brute force on 5 deterministic overlap cases.");
