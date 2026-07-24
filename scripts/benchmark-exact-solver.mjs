import { createServer } from "vite";
import { solveExactOptimal } from "../src/model/exactOptimalCore.js";

const CANDIDATE_COUNT = 20;
const BUDGET = 2_500_000;

const makeRandom = (seed) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const cityModel = await server.ssrLoadModule("/src/model/cityModel.js");
  const cells = cityModel.buildCity();
  const baselineDemand = cityModel.getDemandState(cells);
  const demandCells = cells
    .filter((cell) => !cell.outside && !cell.water)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      score: 100,
      heat: cell.heat,
      population: baselineDemand.residual[cell.y * cityModel.GRID_COLS + cell.x],
    }));

  for (const seed of [7, 19, 41, 83, 131]) {
    const candidates = cityModel
      .selectChallengeSites(cells, CANDIDATE_COUNT, makeRandom(seed))
      .map((cell) => ({
        id: cell.id,
        x: cell.x,
        y: cell.y,
        housingCostIndex: cell.housingCostIndex,
      }));
    const result = solveExactOptimal({
      candidates,
      demandCells,
      budget: BUDGET,
      columns: cityModel.GRID_COLS,
      rows: cityModel.GRID_ROWS,
      serviceRadius: cityModel.FIXED_SERVICE_RADIUS,
      capacityOptions: cityModel.STATION_CAPACITIES,
      costModel: cityModel.STATION_COST_MODEL,
    });
    console.log({
      seed,
      elapsedMs: result.stats.elapsedMs,
      nodes: result.stats.nodes,
      pruned: result.stats.pruned,
      objective: result.stats.objective,
      stations: result.solution.length,
    });
  }
} finally {
  await server.close();
}
