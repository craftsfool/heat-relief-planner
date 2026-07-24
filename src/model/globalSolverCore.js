import { solveExactOptimal } from "./exactOptimalCore.js";
import { solveGreedyLocal } from "./greedyLocalCore.js";
import {
  createSolutionRecord,
  createSolverTask,
  normalizeSolverConfig,
} from "./solverTask.js";

export function solveGlobalConfiguration(config, {
  onProgress,
  source = "solver",
  refinementLimit = Number.POSITIVE_INFINITY,
} = {}) {
  const normalized = normalizeSolverConfig(config);
  const task = createSolverTask(normalized);
  const traversal = solveGreedyLocal(task.solverInput, {
    onProgress: (progress) => onProgress?.({ stage: "traversal", ...progress }),
  });
  const refinementIdSet = new Set(traversal.refinementIds.slice(0, refinementLimit));
  const refinementPool = task.candidates.filter((candidate) => refinementIdSet.has(candidate.id));
  const exact = solveExactOptimal({
    ...task.solverInput,
    candidates: refinementPool,
    onProgress: (progress) => onProgress?.({ stage: "refinement", ...progress }),
  });

  if (!exact.stats.optimal) {
    throw new Error("The refinement solver finished without an optimality proof.");
  }
  exact.stats.traversedCandidateCount = task.candidates.length;
  exact.stats.refinementPoolLimit = Number.isFinite(refinementLimit)
    ? refinementLimit
    : traversal.refinementIds.length;
  return createSolutionRecord(normalized, exact, source);
}
