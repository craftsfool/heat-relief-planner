import {
  STATION_RADII,
  estimateCellPopulation,
  getCellMetrics,
  getStationCoverage,
} from "./cityModel";

let solverPromise;

const formatCoefficient = (value) => Number(value.toFixed(6));

const wrapTerms = (terms, indent = "  ", termsPerLine = 6) => {
  const lines = [];
  for (let index = 0; index < terms.length; index += termsPerLine) {
    lines.push(`${indent}${terms.slice(index, index + termsPerLine).join(" ")}`);
  }
  return lines;
};

const loadSolver = () => {
  if (!solverPromise) {
    solverPromise = Promise.all([
      import("highs"),
      import("highs/runtime?url"),
    ]).then(([highsModule, runtimeModule]) => {
      const createHighs = highsModule.default ?? highsModule;
      return createHighs({
        locateFile: () => runtimeModule.default,
        print: () => {},
        printErr: () => {},
      });
    });
  }
  return solverPromise;
};

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

export async function generateOptimalSolution(candidateCells, cells, budget) {
  const [{ model, stationOptions }, solver] = await Promise.all([
    Promise.resolve(buildOptimalProblem(candidateCells, cells, budget)),
    loadSolver(),
  ]);
  const result = solver.solve(model, {
    mip_rel_gap: 0,
    output_flag: false,
    time_limit: 20,
  });

  if (result.Status !== "Optimal") {
    throw new Error(`Optimal solver stopped with status: ${result.Status}`);
  }

  return stationOptions
    .filter(({ variable }) => result.Columns[variable]?.Primal > 0.5)
    .map(({ candidate, radius, cost }) => ({
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      radius,
      cost,
    }));
}
