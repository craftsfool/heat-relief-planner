import queenstownGrid from "../data/queenstownGrid.json";

export const GRID_COLS = queenstownGrid.metadata.columns;
export const GRID_ROWS = queenstownGrid.metadata.rows;
export const CELL_SIZE_METRES = queenstownGrid.metadata.cellSizeMetres;
export const MAP_METADATA = queenstownGrid.metadata;
export const MAP_SUBZONES = queenstownGrid.subzones;
export const STATION_RADII = [100, 150, 200, 250, 300];
export const SHELTER_SCORE_REDUCTION = 30;

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
const POPULATION_AREA_SCALE = (CELL_SIZE_METRES / 160) ** 2;
const MIN_CANDIDATE_SPACING_CELLS = Math.max(2, Math.round(320 / CELL_SIZE_METRES));

const decodeCell = (packed) => {
  if (!Array.isArray(packed)) return packed;
  const [x, y, lon, lat, subzoneIndex, flags, heat, vulnerable, flow, cooling] = packed;
  const subzone = MAP_SUBZONES[subzoneIndex];
  return {
    id: `${x}-${y}`,
    x,
    y,
    lon,
    lat,
    subzoneCode: subzone.code,
    zone: subzone.name,
    water: Boolean(flags & 1),
    park: Boolean(flags & 2),
    road: flags & 4 ? "major" : flags & 8 ? "minor" : undefined,
    buildable: Boolean(flags & 16),
    building: Boolean(flags & 32),
    construction: Boolean(flags & 64),
    facility: Boolean(flags & 128),
    transit: Boolean(flags & 256),
    heat,
    vulnerable,
    flow,
    cooling,
  };
};

const baseCells = queenstownGrid.cells.map(decodeCell);

const distanceToCellArea = (a, b) =>
  Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - CELL_HALF_DIAGONAL);

const shuffled = (items, random = Math.random) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

export function buildCity(time = "afternoon", scenario = "baseline") {
  const heatTimeBoost = time === "afternoon" ? 0.16 : time === "morning" ? -0.05 : 0.04;
  const flowTimeBoost = time === "evening" ? 0.12 : time === "morning" ? 0.08 : 0;
  const scenarioHeatBoost = scenario === "heatwave" ? 0.18 : 0;
  const scenarioFlowBoost = scenario === "high-growth" ? 0.18 : 0;

  return baseCells.map((cell) => {
    if (cell.outside || cell.water) return { ...cell };
    return {
      ...cell,
      heat: clamp(cell.heat + heatTimeBoost + scenarioHeatBoost),
      flow: clamp(cell.flow + flowTimeBoost + scenarioFlowBoost),
    };
  });
}

export function getStationCoverage(cell, placedStations = []) {
  if (!cell || cell.outside || cell.water || !placedStations.length) return 0;

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
    if (coolingOnlyScore <= 0) return Math.round(clamp(coolingOnlyScore, -100, 100));
    return Math.round(Math.max(0, coolingOnlyScore - SHELTER_SCORE_REDUCTION * stationCoverage));
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

  if (baseScore <= 0) return Math.round(baseScore);
  return Math.round(Math.max(0, baseScore - SHELTER_SCORE_REDUCTION * stationCoverage));
}

export function getPriorityReduction(cells, placedStations, weights, enabledLayers) {
  if (!placedStations.length) return 0;
  const reduction = cells.reduce((sum, cell) => {
    if (cell.outside || cell.water) return sum;
    const baseScore = Math.max(0, scoreCell(cell, weights, enabledLayers));
    if (!baseScore) return sum;
    return sum + Math.min(
      baseScore,
      SHELTER_SCORE_REDUCTION * getStationCoverage(cell, placedStations),
    );
  }, 0);
  return Math.round(reduction);
}

export function selectChallengeSites(cells, count = 12, random = Math.random) {
  const poolsBySubzone = new Map();
  for (const cell of shuffled(cells.filter((candidate) => candidate.buildable), random)) {
    const pool = poolsBySubzone.get(cell.subzoneCode) ?? [];
    pool.push(cell);
    poolsBySubzone.set(cell.subzoneCode, pool);
  }
  const subzonePools = shuffled([...poolsBySubzone.values()], random);
  const selected = [];

  while (selected.length < count) {
    let addedThisRound = false;
    for (const pool of subzonePools) {
      const candidateIndex = pool.findIndex((cell) => selected.every(
        (candidate) => Math.hypot(candidate.x - cell.x, candidate.y - cell.y) >= MIN_CANDIDATE_SPACING_CELLS,
      ));
      if (candidateIndex < 0) continue;
      selected.push(pool.splice(candidateIndex, 1)[0]);
      addedThisRound = true;
      if (selected.length === count) break;
    }
    if (!addedThisRound) break;
  }

  if (selected.length < count) {
    const selectedIds = new Set(selected.map((cell) => cell.id));
    const remainder = subzonePools.flat().filter((cell) => !selectedIds.has(cell.id));
    selected.push(...remainder.slice(0, count - selected.length));
  }

  return selected;
}

export function rankChallengeSites(cells, siteIds, weights, enabledLayers) {
  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  return siteIds
    .map((id) => cellById.get(id))
    .filter(Boolean)
    .map((cell) => ({
      ...cell,
      score: scoreCell(cell, weights, enabledLayers),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function estimateCellPopulation(cell) {
  if (!cell || cell.outside || cell.water) return 0;
  const densityIndex = 0.68 * cell.vulnerable + 0.32 * cell.flow;
  return (35 + densityIndex * 720) * POPULATION_AREA_SCALE;
}

export function getPopulationReached(cells, placedStations = []) {
  if (!placedStations.length) return 0;
  return Math.round(
    cells.reduce(
      (sum, cell) => sum + estimateCellPopulation(cell) * getStationCoverage(cell, placedStations),
      0,
    ),
  );
}

export function getCellMetrics(cell, radius, cells) {
  if (!cell) return { cost: 0, protectedHours: 0, coveredCells: 0, peopleReached: 0 };
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
    peopleReached: getPopulationReached(cells, [{ ...cell, radius }]),
  };
}

export function generateRandomSolution(candidateCells, cells, budget, random = Math.random) {
  const solution = [];
  const remainingCandidates = shuffled(candidateCells, random);
  let remainingBudget = budget;

  const placeRandomAffordableStation = (cell) => {
    const affordableRadii = STATION_RADII.filter(
      (radius) => getCellMetrics(cell, radius, cells).cost <= remainingBudget,
    );
    if (!affordableRadii.length) return false;
    const radius = affordableRadii[Math.floor(random() * affordableRadii.length)];
    const { cost } = getCellMetrics(cell, radius, cells);
    solution.push({ id: cell.id, x: cell.x, y: cell.y, radius, cost });
    remainingBudget -= cost;
    return true;
  };

  for (const cell of remainingCandidates) {
    if (random() >= 0.48) placeRandomAffordableStation(cell);
  }

  while (true) {
    const placedIds = new Set(solution.map((station) => station.id));
    const affordable = remainingCandidates.filter(
      (cell) =>
        !placedIds.has(cell.id) &&
        getCellMetrics(cell, STATION_RADII[0], cells).cost <= remainingBudget,
    );
    if (!affordable.length) break;
    placeRandomAffordableStation(affordable[Math.floor(random() * affordable.length)]);
  }

  return solution;
}
