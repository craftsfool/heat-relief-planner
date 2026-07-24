import {
  BASE_COST_BY_RADIUS,
  GRID_COLS,
  GRID_ROWS,
  MAP_METADATA,
  MAP_SUBZONES,
  STATION_CAPACITY_BY_RADIUS,
  STATION_RADII,
  buildCity,
  getDemandState,
} from "./cityModel.js";

export const SOLVER_SCHEMA_VERSION = 4;
export const STANDARD_BUDGET = 2_500_000;

const compactDate = (value) => String(value ?? "unknown")
  .slice(0, 10)
  .replaceAll("-", "");

export const SOLVER_DATA_VERSION = [
  "queenstown",
  compactDate(MAP_METADATA.generatedAt),
  compactDate(MAP_METADATA.socioeconomicSource?.generatedAt),
  compactDate(MAP_METADATA.existingShelterSource?.generatedAt),
  `s${SOLVER_SCHEMA_VERSION}`,
].join("-");

const safePart = (value) => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "");

export function normalizeSolverConfig(config = {}) {
  const subzoneCode = MAP_SUBZONES.some((subzone) => subzone.code === config.subzoneCode)
    ? config.subzoneCode
    : null;
  const requestedBudget = Number(config.budget);
  const budget = Number.isFinite(requestedBudget)
    ? Math.max(180_000, Math.min(20_000_000, Math.round(requestedBudget / 1000) * 1000))
    : STANDARD_BUDGET;

  return { subzoneCode, budget };
}

export function getSolverKey(config = {}) {
  const normalized = normalizeSolverConfig(config);
  const scope = normalized.subzoneCode ? safePart(normalized.subzoneCode) : "queenstown";
  return [
    SOLVER_DATA_VERSION,
    scope,
    normalized.budget,
  ].join("/");
}

export function getStaticSolutionPath(config = {}) {
  return `/solutions/${getSolverKey(config)}.json`;
}

export function isStandardSolverConfig(config = {}) {
  const normalized = normalizeSolverConfig(config);
  return normalized.subzoneCode === null && normalized.budget === STANDARD_BUDGET;
}

export function createSolverTask(config = {}) {
  const normalized = normalizeSolverConfig(config);
  const allCells = buildCity();
  const cells = normalized.subzoneCode
    ? allCells.filter((cell) => cell.subzoneCode === normalized.subzoneCode)
    : allCells;
  const candidates = cells
    .filter((cell) => cell.buildable)
    .map((cell) => ({
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

  return {
    config: normalized,
    cells,
    candidates,
    solverInput: {
      candidates,
      demandCells,
      budget: normalized.budget,
      columns: GRID_COLS,
      rows: GRID_ROWS,
      radii: STATION_RADII,
      capacities: STATION_CAPACITY_BY_RADIUS,
      baseCosts: BASE_COST_BY_RADIUS,
      fullTraversal: true,
    },
  };
}

export function createSolutionRecord(config, result, source) {
  const normalized = normalizeSolverConfig(config);
  return {
    schemaVersion: SOLVER_SCHEMA_VERSION,
    dataVersion: SOLVER_DATA_VERSION,
    key: getSolverKey(normalized),
    source,
    generatedAt: new Date().toISOString(),
    config: normalized,
    solution: result.solution,
    stats: result.stats,
  };
}

export function validateSolutionRecord(record, config = {}) {
  if (!record || record.schemaVersion !== SOLVER_SCHEMA_VERSION) return false;
  if (record.dataVersion !== SOLVER_DATA_VERSION) return false;
  if (record.key !== getSolverKey(config)) return false;
  return Array.isArray(record.solution) && record.solution.every((station) =>
    typeof station.id === "string"
    && Number.isFinite(station.x)
    && Number.isFinite(station.y)
    && Number.isFinite(station.radius)
    && Number.isFinite(station.cost));
}
