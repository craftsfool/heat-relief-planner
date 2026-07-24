import {
  GRID_COLS,
  GRID_ROWS,
  BASE_COST_BY_RADIUS,
  STATION_RADII,
  STATION_CAPACITY_BY_RADIUS,
  getDemandState,
} from "./cityModel.js";

let nextRequestId = 1;

const runSolverWorker = (payload, {
  onProgress,
  includeTrace = false,
  fullTraversal = false,
} = {}) => new Promise((resolve, reject) => {
  const worker = new Worker(
    new URL("../workers/greedyLocalSolver.worker.js", import.meta.url),
    { type: "module" },
  );
  const id = nextRequestId;
  nextRequestId += 1;

  const finish = () => worker.terminate();
  worker.onmessage = ({ data }) => {
    if (data.id !== id) return;
    if (data.progress) {
      onProgress?.(data.progress);
      return;
    }
    finish();
    if (data.error) {
      reject(new Error(data.error));
    } else if (includeTrace) {
      resolve({ solution: data.solution, steps: data.steps ?? [] });
    } else if (fullTraversal) {
      resolve({
        solution: data.solution,
        refinementIds: data.refinementIds ?? data.solution.map((station) => station.id),
      });
    } else {
      resolve(data.solution);
    }
  };
  worker.onerror = (event) => {
    finish();
    reject(new Error(event.message || "Greedy local solver failed"));
  };
  worker.postMessage({ id, ...payload });
});

const getParallelWorkerCount = (candidateCount) => {
  const hardwareCount = Number(globalThis.navigator?.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, hardwareCount - 1, Math.ceil(candidateCount / 3000)));
};

const runParallelTraversal = async (payload, onProgress) => {
  const workerCount = getParallelWorkerCount(payload.candidates.length);
  if (workerCount <= 1) {
    return runSolverWorker(payload, { onProgress, fullTraversal: true });
  }

  const shards = Array.from({ length: workerCount }, () => []);
  const ordered = [...payload.candidates].sort((a, b) => a.x - b.x || a.y - b.y);
  for (let index = 0; index < ordered.length; index += 1) {
    shards[index % workerCount].push(ordered[index]);
  }
  onProgress?.({
    phase: "parallel",
    workerCount,
    candidateCount: payload.candidates.length,
  });

  const shardResults = await Promise.all(shards.map((candidates, shardIndex) =>
    runSolverWorker(
      { ...payload, candidates, fullTraversal: true },
      {
        fullTraversal: true,
        onProgress: (progress) => onProgress?.({
          ...progress,
          phase: `parallel-${progress.phase}`,
          shardIndex,
          workerCount,
        }),
      },
    )));

  const mergedIds = new Set();
  for (const result of shardResults) {
    for (const id of result.refinementIds) mergedIds.add(id);
    for (const station of result.solution) mergedIds.add(station.id);
  }
  const mergedCandidates = payload.candidates.filter((candidate) => mergedIds.has(candidate.id));
  onProgress?.({
    phase: "consolidation",
    workerCount,
    candidateCount: payload.candidates.length,
    searchCount: mergedCandidates.length,
  });
  return runSolverWorker(
    { ...payload, candidates: mergedCandidates, fullTraversal: true },
    { onProgress, fullTraversal: true },
  );
};

export function generateGreedyLocalSolution(
  candidateCells,
  cells,
  budget,
  {
    onProgress,
    includeTrace = false,
    greedyOnly = false,
    fullTraversal = false,
    parallel = true,
  } = {},
) {
  const candidates = candidateCells.map((cell) => ({
    id: cell.id,
    x: cell.x,
    y: cell.y,
    housingCostIndex: cell.housingCostIndex,
    score: 1,
  }));
  const baselineDemand = getDemandState(cells);
  const demandCells = cells
    .filter((cell) => !cell.outside && !cell.water)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      score: 100,
      heat: cell.heat,
      population: baselineDemand.residual[cell.y * GRID_COLS + cell.x],
    }));

  const payload = {
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
  };
  if (fullTraversal && parallel && candidates.length > 3000) {
    return runParallelTraversal(payload, onProgress);
  }
  return runSolverWorker(payload, { onProgress, includeTrace, fullTraversal });
}

export function generateGreedyDemonstration(
  candidateCells,
  cells,
  budget,
) {
  return generateGreedyLocalSolution(
    candidateCells,
    cells,
    budget,
    { includeTrace: true, greedyOnly: true },
  );
}
