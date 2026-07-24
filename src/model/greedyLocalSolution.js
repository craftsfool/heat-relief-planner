import {
  GRID_COLS,
  GRID_ROWS,
  BASE_COST_BY_RADIUS,
  STATION_RADII,
  STATION_CAPACITY_BY_RADIUS,
  getDemandState,
  scoreCell,
} from "./cityModel";

let solverWorker;
let nextRequestId = 1;
const pendingRequests = new Map();

const getSolverWorker = () => {
  if (!solverWorker) {
    solverWorker = new Worker(new URL("../workers/greedyLocalSolver.worker.js", import.meta.url), { type: "module" });
    solverWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id);
      if (!request) return;
      if (data.progress) {
        request.onProgress?.(data.progress);
        return;
      }
      pendingRequests.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else if (request.includeTrace) {
        request.resolve({ solution: data.solution, steps: data.steps ?? [] });
      } else if (request.fullTraversal) {
        request.resolve({
          solution: data.solution,
          refinementIds: data.refinementIds ?? data.solution.map((station) => station.id),
        });
      } else {
        request.resolve(data.solution);
      }
    };
    solverWorker.onerror = (event) => {
      pendingRequests.forEach(({ reject }) => reject(new Error(event.message || "Greedy local solver failed")));
      pendingRequests.clear();
      solverWorker = null;
    };
  }
  return solverWorker;
};

export function generateGreedyLocalSolution(
  candidateCells,
  cells,
  budget,
  weights,
  enabledLayers,
  {
    onProgress,
    includeTrace = false,
    greedyOnly = false,
    fullTraversal = false,
  } = {},
) {
  const id = nextRequestId;
  nextRequestId += 1;
  const candidates = candidateCells.map((cell) => ({
    id: cell.id,
    x: cell.x,
    y: cell.y,
    housingCostIndex: cell.housingCostIndex,
    score: Math.max(0, scoreCell(cell, weights, enabledLayers)),
  }));
  const baselineDemand = getDemandState(cells);
  const demandCells = cells
    .filter((cell) => !cell.outside && !cell.water)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      score: Math.max(0, scoreCell(cell, weights, enabledLayers)),
      population: baselineDemand.residual[cell.y * GRID_COLS + cell.x],
    }));

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, {
      resolve,
      reject,
      onProgress,
      includeTrace,
      fullTraversal,
    });
    getSolverWorker().postMessage({
      id,
      candidates,
      demandCells,
      budget,
      columns: GRID_COLS,
      rows: GRID_ROWS,
      radii: STATION_RADII,
      capacities: STATION_CAPACITY_BY_RADIUS,
      baseCosts: BASE_COST_BY_RADIUS,
      includeTrace,
      greedyOnly,
      fullTraversal,
    });
  });
}

export function generateGreedyDemonstration(
  candidateCells,
  cells,
  budget,
  weights,
  enabledLayers,
) {
  return generateGreedyLocalSolution(
    candidateCells,
    cells,
    budget,
    weights,
    enabledLayers,
    { includeTrace: true, greedyOnly: true },
  );
}
