import {
  GRID_COLS,
  GRID_ROWS,
  SHELTER_SCORE_REDUCTION,
  STATION_RADII,
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
      else request.resolve(data.solution);
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
  { onProgress } = {},
) {
  const id = nextRequestId;
  nextRequestId += 1;
  const candidates = candidateCells.map((cell) => ({
    id: cell.id,
    x: cell.x,
    y: cell.y,
    flow: cell.flow,
    score: Math.max(0, scoreCell(cell, weights, enabledLayers)),
  }));
  const demandCells = cells
    .filter((cell) => !cell.outside && !cell.water)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      score: Math.max(0, scoreCell(cell, weights, enabledLayers)),
    }));

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, onProgress });
    getSolverWorker().postMessage({
      id,
      candidates,
      demandCells,
      budget,
      columns: GRID_COLS,
      rows: GRID_ROWS,
      radii: STATION_RADII,
      scoreReduction: SHELTER_SCORE_REDUCTION,
    });
  });
}
