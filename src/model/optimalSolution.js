import {
  STATION_RADII,
  estimateCellPopulation,
  getCellMetrics,
  getStationCoverage,
} from "./cityModel";

let solverWorker;
let nextRequestId = 1;
const pendingRequests = new Map();

const formatCoefficient = (value) => Number(value.toFixed(6));

const wrapTerms = (terms, indent = "  ", termsPerLine = 6) => {
  const lines = [];
  for (let index = 0; index < terms.length; index += termsPerLine) {
    lines.push(`${indent}${terms.slice(index, index + termsPerLine).join(" ")}`);
  }
  return lines;
};

const getSolverWorker = () => {
  if (!solverWorker) {
    solverWorker = new Worker(new URL("../workers/optimalSolver.worker.js", import.meta.url), { type: "module" });
    solverWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id);
      if (!request) return;
      pendingRequests.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data);
    };
    solverWorker.onerror = (event) => {
      pendingRequests.forEach(({ reject }) => reject(new Error(event.message || "Optimal solver worker failed")));
      pendingRequests.clear();
      solverWorker = null;
    };
  }
  return solverWorker;
};

const solveInWorker = (model, stationVariables, timeLimit) => new Promise((resolve, reject) => {
  const id = nextRequestId;
  nextRequestId += 1;
  pendingRequests.set(id, { resolve, reject });
  getSolverWorker().postMessage({ id, model, stationVariables, timeLimit });
});

export function buildOptimalProblem(candidateCells, cells, budget) {
  const demandCells = cells
    .map((cell, index) => ({ cell, index, population: estimateCellPopulation(cell) }))
    .filter(({ population }) => population > 0);
  const stationOptions = [];
  const assignmentsByCell = new Map();
  const objectiveTerms = [];
  const linkConstraints = [];

  candidateCells.forEach((candidate, candidateIndex) => {
    STATION_RADII.forEach((radius) => {
      const variable = `x_${candidateIndex}_${radius}`;
      const { cost } = getCellMetrics(candidate, radius, cells);
      stationOptions.push({ variable, candidate, radius, cost });

      demandCells.forEach(({ cell, index, population }) => {
        const coverage = getStationCoverage(cell, [{ ...candidate, radius }]);
        if (coverage <= 0) return;

        const assignment = `z_${candidateIndex}_${radius}_${index}`;
        const contribution = formatCoefficient(population * coverage);
        objectiveTerms.push(`+ ${contribution} ${assignment}`);
        linkConstraints.push(` link_${candidateIndex}_${radius}_${index}: ${assignment} - ${variable} <= 0`);

        const cellAssignments = assignmentsByCell.get(index) ?? [];
        cellAssignments.push(assignment);
        assignmentsByCell.set(index, cellAssignments);
      });
    });
  });

  const budgetTerms = stationOptions.map(({ cost, variable }) => `+ ${cost} ${variable}`);
  const siteConstraints = candidateCells.map((_, candidateIndex) => {
    const siteTerms = STATION_RADII.map((radius) => `+ x_${candidateIndex}_${radius}`).join(" ");
    return ` site_${candidateIndex}: ${siteTerms} <= 1`;
  });
  const assignmentConstraints = [...assignmentsByCell.entries()].map(
    ([index, assignments]) => ` demand_${index}: ${assignments.map((name) => `+ ${name}`).join(" ")} <= 1`,
  );

  const lines = [
    "Maximize",
    " population:",
    ...wrapTerms(objectiveTerms),
    "Subject To",
    ` budget: ${budgetTerms.join(" ")} <= ${budget}`,
    ...siteConstraints,
    ...assignmentConstraints,
    ...linkConstraints,
    "Binary",
    ...wrapTerms(stationOptions.map(({ variable }) => variable), " ", 12),
    "End",
  ];

  return { model: lines.join("\n"), stationOptions };
}

export async function generateOptimalSolution(candidateCells, cells, budget, { timeLimit = 20 } = {}) {
  const { model, stationOptions } = buildOptimalProblem(candidateCells, cells, budget);
  const result = await solveInWorker(
    model,
    stationOptions.map(({ variable }) => variable),
    timeLimit,
  );

  if (result.status !== "Optimal") {
    throw new Error(`Optimal solver stopped with status: ${result.status}`);
  }

  return stationOptions
    .filter(({ variable }) => result.selectedVariables.includes(variable))
    .map(({ candidate, radius, cost }) => ({
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      radius,
      cost,
    }));
}
