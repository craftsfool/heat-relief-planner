import { solveExactOptimal } from "./exactOptimalCore.js";
import { solveGreedyLocal } from "./greedyLocalCore.js";
import {
  STATION_CAPACITIES,
  getDemandState,
  getStationCost,
} from "./cityModel.js";
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
  const jointAllocation = getDemandState(task.cells, exact.solution);
  const minimumCostByCapacity = new Map(STATION_CAPACITIES.map((capacity) => [
    capacity,
    Math.min(...task.candidates.map((candidate) => getStationCost(candidate, capacity))),
  ]));
  const capacityUpper = new Int32Array(Math.floor(normalized.budget / 1000) + 1);
  for (let budgetUnits = 0; budgetUnits < capacityUpper.length; budgetUnits += 1) {
    for (const capacity of STATION_CAPACITIES) {
      const costUnits = minimumCostByCapacity.get(capacity) / 1000;
      if (costUnits > budgetUnits) continue;
      capacityUpper[budgetUnits] = Math.max(
        capacityUpper[budgetUnits],
        capacityUpper[budgetUnits - costUnits] + capacity,
      );
    }
  }
  const capacityUpperBound = Math.max(...capacityUpper);
  exact.stats.sequentialSolverObjective = exact.stats.objective;
  exact.stats.population = Math.round(jointAllocation.servedByPlaced);
  exact.stats.objective = exact.stats.population;
  exact.stats.spent = exact.solution.reduce((sum, station) => sum + station.cost, 0);
  exact.stats.capacityUpperBound = capacityUpperBound;
  exact.stats.globallyOptimal = exact.stats.population === capacityUpperBound;
  exact.stats.proofMethod = exact.stats.globallyOptimal
    ? "feasible-population-equals-unbounded-capacity-budget-upper-bound"
    : "full-traversal-with-exact-refinement";
  exact.stats.allocationRule = "joint-max-flow-euclidean-distance-heat-tiebreak";
  exact.stats.traversedCandidateCount = task.candidates.length;
  exact.stats.refinementPoolLimit = Number.isFinite(refinementLimit)
    ? refinementLimit
    : traversal.refinementIds.length;
  return createSolutionRecord(normalized, exact, source);
}
