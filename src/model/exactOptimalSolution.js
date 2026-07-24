import {
  GRID_COLS,
  GRID_ROWS,
  BASE_COST_BY_RADIUS,
  STATION_RADII,
  STATION_CAPACITY_BY_RADIUS,
  getDemandState,
} from "./cityModel";

let exactWorker;
let nextRequestId = 1;
const pendingRequests = new Map();

const getExactWorker = () => {
  if (!exactWorker) {
    exactWorker = new Worker(new URL("../workers/exactOptimalSolver.worker.js", import.meta.url), { type: "module" });
    exactWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id);
      if (!request) return;
      if (data.progress) {
        request.onProgress?.(data.progress);
        return;
      }
      pendingRequests.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve({ solution: data.solution, stats: data.stats });
    };
    exactWorker.onerror = (event) => {
      pendingRequests.forEach(({ reject }) => reject(new Error(event.message || "Exact solver failed")));
      pendingRequests.clear();
      exactWorker = null;
    };
  }
  return exactWorker;
};

export function generateExactOptimalSolution(
  candidateCells,
  cells,
  budget,
  { onProgress } = {},
) {
  const id = nextRequestId;
  nextRequestId += 1;
  const candidates = candidateCells.map((cell) => ({
    id: cell.id,
    x: cell.x,
    y: cell.y,
    housingCostIndex: cell.housingCostIndex,
  }));
  const baselineDemand = getDemandState(cells);
  const demandCells = cells
    .filter((cell) => !cell.outside && !cell.water)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      score: 100,
      population: baselineDemand.residual[cell.y * GRID_COLS + cell.x],
    }));

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, onProgress });
    getExactWorker().postMessage({
      id,
      candidates,
      demandCells,
      budget,
      columns: GRID_COLS,
      rows: GRID_ROWS,
      radii: STATION_RADII,
      capacities: STATION_CAPACITY_BY_RADIUS,
      baseCosts: BASE_COST_BY_RADIUS,
    });
  });
}
