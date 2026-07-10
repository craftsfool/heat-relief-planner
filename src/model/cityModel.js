import queenstownGrid from "../data/queenstownGrid.json";

export const GRID_COLS = queenstownGrid.metadata.columns;
export const GRID_ROWS = queenstownGrid.metadata.rows;
export const CELL_SIZE_METRES = queenstownGrid.metadata.cellSizeMetres;
export const MAP_METADATA = queenstownGrid.metadata;
export const MAP_LABELS = queenstownGrid.labels;

export const LAYER_DEFINITIONS = [
  {
    id: "heat",
    label: "Heat exposure",
    shortLabel: "Heat",
    color: "#f15b5a",
    defaultWeight: 0.35,
    direction: 1,
  },
  {
    id: "vulnerable",
    label: "Vulnerable population",
    shortLabel: "Vulnerability",
    color: "#f2b544",
    defaultWeight: 0.3,
    direction: 1,
  },
  {
    id: "flow",
    label: "Pedestrian flow",
    shortLabel: "Footfall",
    color: "#41ad9e",
    defaultWeight: 0.2,
    direction: 1,
  },
  {
    id: "cooling",
    label: "Existing cooling facilities",
    shortLabel: "Nearby facilities",
    color: "#7890a4",
    defaultWeight: 0.15,
    direction: -1,
  },
];

const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const CELL_HALF_DIAGONAL = Math.SQRT2 / 2;

const distanceToCellArea = (a, b) =>
  Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - CELL_HALF_DIAGONAL);

export function buildCity(time = "afternoon", scenario = "baseline") {
  const heatTimeBoost = time === "afternoon" ? 0.16 : time === "morning" ? -0.05 : 0.04;
  const flowTimeBoost = time === "evening" ? 0.12 : time === "morning" ? 0.08 : 0;
  const scenarioHeatBoost = scenario === "heatwave" ? 0.18 : 0;
  const scenarioFlowBoost = scenario === "high-growth" ? 0.18 : 0;

  return queenstownGrid.cells.map((cell) => {
    if (cell.outside || cell.water) return { ...cell };
    return {
      ...cell,
      heat: clamp(cell.heat + heatTimeBoost + scenarioHeatBoost),
      flow: clamp(cell.flow + flowTimeBoost + scenarioFlowBoost),
    };
  });
}

export function getStationCoverage(cell, placedStations = []) {
  if (!placedStations.length) return 0;

  return Math.max(
    ...placedStations.map((station) => {
      const radiusInCells = (station.radius ?? 150) / CELL_SIZE_METRES;
      const distance = distanceToCellArea(station, cell);
      if (distance > radiusInCells) return 0;
      return clamp(1 - distance / radiusInCells);
    }),
  );
}

export function scoreCell(cell, weights, enabledLayers, placedStations = []) {
  if (cell.outside) return 0;

  const stationCoverage = getStationCoverage(cell, placedStations);
  const positiveWeight = LAYER_DEFINITIONS.filter(
    (layer) => layer.direction > 0 && enabledLayers[layer.id],
  ).reduce((sum, layer) => sum + weights[layer.id], 0);

  if (!positiveWeight) {
    const coolingOnlyScore = enabledLayers.cooling ? -cell.cooling * 100 : 0;
    return Math.round(
      clamp(coolingOnlyScore - 72 * stationCoverage, -100, 100),
    );
  }

  const positive = LAYER_DEFINITIONS.filter(
    (layer) => layer.direction > 0 && enabledLayers[layer.id],
  ).reduce((sum, layer) => sum + cell[layer.id] * weights[layer.id], 0);

  const coolingPenalty = enabledLayers.cooling
    ? cell.cooling * weights.cooling * 0.7
    : 0;

  const baseScore = clamp(
    (positive / positiveWeight - coolingPenalty) * 100,
    -100,
    100,
  );

  return Math.round(clamp(baseScore - 72 * stationCoverage, -100, 100));
}

export function rankCandidates(cells, weights, enabledLayers, placedStations = [], limit = 3) {
  const placedIds = new Set(placedStations.map((station) => station.id));
  const ranked = cells
    .filter((cell) => cell.buildable && !placedIds.has(cell.id))
    .map((cell) => ({
      ...cell,
      score: scoreCell(cell, weights, enabledLayers, placedStations),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  for (const cell of ranked) {
    const separated = selected.every(
      (candidate) => Math.hypot(candidate.x - cell.x, candidate.y - cell.y) >= 4,
    );
    if (separated) selected.push(cell);
    if (selected.length === limit) break;
  }
  return selected;
}

export function getCellMetrics(cell, radius, cells) {
  if (!cell) return { cost: 0, protectedHours: 0, coveredCells: 0 };
  const radiusInCells = radius / CELL_SIZE_METRES;
  const covered = cells.filter(
    (other) =>
      !other.outside &&
      !other.water &&
      distanceToCellArea(other, cell) <= radiusInCells,
  );
  const demand = covered.reduce(
    (sum, other) =>
      sum + other.heat * (0.58 * other.vulnerable + 0.42 * other.flow),
    0,
  );
  const landFactor = 0.45 + 0.55 * cell.flow;
  const cost = Math.round((160000 + radius * 650 + landFactor * 85000) / 1000) * 1000;

  return {
    cost,
    protectedHours: Math.round(demand * 240),
    coveredCells: covered.length,
  };
}
