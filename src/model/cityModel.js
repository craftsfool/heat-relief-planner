import queenstownGrid from "../data/queenstownGrid.json" with { type: "json" };
import { allocatePopulationToStations } from "./populationAllocation.js";
import {
  DEFAULT_STATION_CAPACITY,
  FIXED_SERVICE_RADIUS,
  STATION_CAPACITIES,
  getStationCost,
} from "./stationModel.js";

export {
  DEFAULT_STATION_CAPACITY,
  FIXED_SERVICE_RADIUS,
  STATION_CAPACITIES,
  STATION_COST_MODEL,
  getStationCost,
} from "./stationModel.js";

export const GRID_COLS = queenstownGrid.metadata.columns;
export const GRID_ROWS = queenstownGrid.metadata.rows;
export const CELL_SIZE_METRES = queenstownGrid.metadata.cellSizeMetres;
export const MAP_METADATA = queenstownGrid.metadata;
export const MAP_SUBZONES = queenstownGrid.subzones;
export const MAP_EXISTING_SHELTERS = queenstownGrid.existingShelters ?? [];
export const PLANNING_WEIGHTS = Object.freeze({
  scenarios: Object.freeze({
    baseline: 0.60,
    highDemand: 0.25,
    heatwave: 0.15,
  }),
  times: Object.freeze({
    morning: 0.20,
    afternoon: 0.60,
    evening: 0.20,
  }),
});
export const DEMAND_DENSITY_BANDWIDTH_METRES = 160;
export const LAYER_DEFINITIONS = [
  {
    id: "demand",
    label: "Population demand",
    shortLabel: "Demand",
    color: "#16a085",
    description: "Smoothed remaining demand density (people/ha).",
  },
  {
    id: "cost",
    label: "Regional cost",
    shortLabel: "Cost",
    color: "#f2b544",
    description: "HDB price proxy used to scale construction cost.",
  },
  {
    id: "heat",
    label: "Heat exposure",
    shortLabel: "Heat",
    color: "#f15b5a",
    description: "Weighted heat exposure across planning scenarios and time periods.",
  },
];

const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const POPULATION_AREA_SCALE = (CELL_SIZE_METRES / 160) ** 2;
const MIN_CANDIDATE_SPACING_CELLS = Math.max(2, Math.round(320 / CELL_SIZE_METRES));

const decodeCell = (packed) => {
  if (!Array.isArray(packed)) return packed;
  const [
    x,
    y,
    lon,
    lat,
    subzoneIndex,
    flags,
    heat,
    vulnerable,
    flow,
    cooling,
    population,
    seniorPopulation,
    housingPricePsm = 0,
    housingCostIndex = 1,
  ] = packed;
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
    population,
    seniorPopulation,
    housingPricePsm,
    housingCostIndex,
  };
};

const decodedCells = queenstownGrid.cells.map(decodeCell);
const maxSeniorPopulation = Math.max(
  1,
  ...decodedCells.map((cell) => cell.seniorPopulation ?? 0),
);
const baseCells = decodedCells.map((cell) => ({
  ...cell,
  vulnerable: Number.isFinite(cell.seniorPopulation)
    ? clamp(Math.sqrt(cell.seniorPopulation / maxSeniorPopulation))
    : cell.vulnerable,
}));
const pricedCells = baseCells.filter((cell) => cell.housingPricePsm > 0);
const MIN_HOUSING_PRICE = Math.min(...pricedCells.map((cell) => cell.housingPricePsm));
const MAX_HOUSING_PRICE = Math.max(...pricedCells.map((cell) => cell.housingPricePsm));

const distanceBetweenCellCentresMetres = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y) * CELL_SIZE_METRES;

const shuffled = (items, random = Math.random) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

export function buildCity() {
  const heatTimeBoost =
    PLANNING_WEIGHTS.times.morning * -0.05
    + PLANNING_WEIGHTS.times.afternoon * 0.16
    + PLANNING_WEIGHTS.times.evening * 0.04;
  const flowTimeBoost =
    PLANNING_WEIGHTS.times.morning * 0.08
    + PLANNING_WEIGHTS.times.evening * 0.12;
  const scenarioHeatBoost = PLANNING_WEIGHTS.scenarios.heatwave * 0.18;
  const scenarioFlowBoost = PLANNING_WEIGHTS.scenarios.highDemand * 0.18;
  const scenarioDemandMultiplier =
    PLANNING_WEIGHTS.scenarios.baseline
    + PLANNING_WEIGHTS.scenarios.highDemand * 1.15
    + PLANNING_WEIGHTS.scenarios.heatwave;

  return baseCells.map((cell) => {
    if (cell.outside || cell.water) return { ...cell };
    return {
      ...cell,
      heat: clamp(cell.heat + heatTimeBoost + scenarioHeatBoost),
      flow: clamp(cell.flow + flowTimeBoost + scenarioFlowBoost),
      population: Number.isFinite(cell.population)
        ? cell.population * scenarioDemandMultiplier
        : cell.population,
    };
  });
}

const demandBaselineCache = new WeakMap();
const demandLayerCache = new WeakMap();
const distanceBandCache = new Map();
const CELL_AREA_HECTARES = (CELL_SIZE_METRES * CELL_SIZE_METRES) / 10_000;

const getDistanceBands = (radius) => {
  if (distanceBandCache.has(radius)) return distanceBandCache.get(radius);
  const reach = Math.max(0, Math.ceil(radius / CELL_SIZE_METRES));
  const maximumDistanceSquared = (radius / CELL_SIZE_METRES) ** 2;
  const offsetsByDistance = new Map();
  for (let offsetY = -reach; offsetY <= reach; offsetY += 1) {
    for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
      const distanceSquared = offsetX ** 2 + offsetY ** 2;
      if (distanceSquared > maximumDistanceSquared) continue;
      const band = offsetsByDistance.get(distanceSquared) ?? [];
      band.push({ x: offsetX, y: offsetY });
      offsetsByDistance.set(distanceSquared, band);
    }
  }
  const bands = [...offsetsByDistance.entries()]
    .sort(([distanceA], [distanceB]) => distanceA - distanceB)
    .map(([, offsets]) => offsets);
  distanceBandCache.set(radius, bands);
  return bands;
};

const demandLayerSurfaceFor = (demandState) => {
  if (!demandState) return { values: new Float64Array(GRID_COLS * GRID_ROWS), maximum: 1 };
  let cached = demandLayerCache.get(demandState);
  if (cached) return cached;

  const sigmaCells = DEMAND_DENSITY_BANDWIDTH_METRES / CELL_SIZE_METRES;
  const kernelRadius = Math.ceil(sigmaCells * 3);
  const kernel = [];
  let kernelSum = 0;
  for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
    const weight = Math.exp(-0.5 * (offset / sigmaCells) ** 2);
    kernel.push(weight);
    kernelSum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= kernelSum;

  const horizontal = new Float64Array(GRID_COLS * GRID_ROWS);
  const values = new Float64Array(GRID_COLS * GRID_ROWS);
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      let smoothed = 0;
      for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX < 0 || sampleX >= GRID_COLS) continue;
        smoothed += demandState.residual[y * GRID_COLS + sampleX] * kernel[offset + kernelRadius];
      }
      horizontal[y * GRID_COLS + x] = smoothed;
    }
  }

  let maximum = 0;
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const index = y * GRID_COLS + x;
      if (!demandState.available[index]) continue;
      let smoothed = 0;
      for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
        const sampleY = y + offset;
        if (sampleY < 0 || sampleY >= GRID_ROWS) continue;
        smoothed += horizontal[sampleY * GRID_COLS + x] * kernel[offset + kernelRadius];
      }
      const densityPerHectare = smoothed / CELL_AREA_HECTARES;
      values[index] = densityPerHectare;
      maximum = Math.max(maximum, densityPerHectare);
    }
  }
  cached = { values, maximum: Math.max(1, maximum) };
  demandLayerCache.set(demandState, cached);
  return cached;
};

const stationCapacity = (station) => station.capacity ?? 0;

const applyShelterToDemand = (residual, available, shelter) => {
  let remainingCapacity = stationCapacity(shelter);
  let served = 0;
  const servedByCell = [];
  if (remainingCapacity <= 0) return { served, servedByCell };

  for (const band of getDistanceBands(shelter.radius ?? 100)) {
    const demandCells = [];
    for (const offset of band) {
      const x = shelter.x + offset.x;
      const y = shelter.y + offset.y;
      if (x < 0 || x >= GRID_COLS || y < 0 || y >= GRID_ROWS) continue;
      const index = y * GRID_COLS + x;
      if (!available[index] || residual[index] <= 0) continue;
      demandCells.push({
        index,
        demand: residual[index],
      });
    }
    demandCells.sort((a, b) => a.index - b.index);
    for (const item of demandCells) {
      const amount = Math.min(item.demand, remainingCapacity);
      residual[item.index] = Math.max(0, residual[item.index] - amount);
      servedByCell.push({ index: item.index, amount });
      served += amount;
      remainingCapacity -= amount;
      if (remainingCapacity <= 1e-6) break;
    }
    if (remainingCapacity <= 1e-6) break;
  }
  return { served, servedByCell };
};

const createBaselineDemand = (cells) => {
  const available = new Uint8Array(GRID_COLS * GRID_ROWS);
  const heatExposure = new Float32Array(GRID_COLS * GRID_ROWS);
  const initial = new Float64Array(GRID_COLS * GRID_ROWS);
  const residual = new Float64Array(GRID_COLS * GRID_ROWS);
  let totalPopulation = 0;
  for (const cell of cells) {
    if (cell.outside || cell.water) continue;
    const index = cell.y * GRID_COLS + cell.x;
    const population = Math.max(0, estimateCellPopulation(cell));
    available[index] = 1;
    heatExposure[index] = clamp(cell.heat);
    initial[index] = population;
    residual[index] = population;
    totalPopulation += population;
  }

  let servedByExisting = 0;
  for (const shelter of MAP_EXISTING_SHELTERS) {
    servedByExisting += applyShelterToDemand(
      residual,
      available,
      shelter,
    ).served;
  }
  return {
    available,
    heatExposure,
    initial,
    afterExisting: residual,
    totalPopulation,
    servedByExisting,
  };
};

const baselineDemandFor = (cells) => {
  let baseline = demandBaselineCache.get(cells);
  if (!baseline) {
    baseline = createBaselineDemand(cells);
    demandBaselineCache.set(cells, baseline);
  }
  return baseline;
};

export function getDemandState(cells, placedStations = []) {
  const baseline = baselineDemandFor(cells);
  const residual = baseline.afterExisting.slice();
  const allocation = allocatePopulationToStations({
    stations: placedStations,
    residual,
    available: baseline.available,
    columns: GRID_COLS,
    rows: GRID_ROWS,
    getDistanceBands,
    stationCapacity,
  });
  return {
    ...baseline,
    residual,
    servedByCell: allocation.servedByCell,
    servedByPlaced: allocation.served,
    perStation: allocation.perStation,
    remainingDemand: residual.reduce((sum, value) => sum + value, 0),
    maxRemainingDemand: residual.reduce((maximum, value) => Math.max(maximum, value), 0),
  };
}

export function getCellDemand(cell, demandState) {
  if (!cell || !demandState) return { initial: 0, afterExisting: 0, remaining: 0, servedByPlayer: 0 };
  const index = cell.y * GRID_COLS + cell.x;
  return {
    initial: demandState.initial[index] ?? 0,
    afterExisting: demandState.afterExisting[index] ?? 0,
    remaining: demandState.residual[index] ?? 0,
    servedByPlayer: demandState.servedByCell[index] ?? 0,
  };
}

export function getLayerValue(cell, layerId, demandState) {
  if (!cell || cell.outside || cell.water) return 0;
  if (layerId === "demand") {
    return demandLayerSurfaceFor(demandState).values[cell.y * GRID_COLS + cell.x] ?? 0;
  }
  if (layerId === "cost") return cell.housingPricePsm ?? 0;
  if (layerId === "heat") return clamp(cell.heat) * 100;
  return 0;
}

export function getLayerIntensity(cell, layerId, demandState) {
  const value = getLayerValue(cell, layerId, demandState);
  if (layerId === "demand") {
    const maximum = demandLayerSurfaceFor(demandState).maximum;
    return clamp(Math.sqrt(value / maximum));
  }
  if (layerId === "cost") {
    return clamp((value - MIN_HOUSING_PRICE) / Math.max(1, MAX_HOUSING_PRICE - MIN_HOUSING_PRICE));
  }
  if (layerId === "heat") return clamp(value / 100);
  return 0;
}

export function formatLayerValue(cell, layerId, demandState, compact = false) {
  const value = getLayerValue(cell, layerId, demandState);
  if (layerId === "demand") {
    const density = Math.round(value).toLocaleString();
    return compact ? density : `${density} people / ha`;
  }
  if (layerId === "cost") {
    return compact
      ? `$${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
      : `$${Math.round(value).toLocaleString()} / m²`;
  }
  if (layerId === "heat") return `${Math.round(value)}%`;
  return "0";
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

export function rankChallengeSites(cells, siteIds) {
  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  const ranked = siteIds
    .map((id) => cellById.get(id))
    .filter(Boolean)
    .map((cell) => {
      const metrics = getCellMetrics(cell, DEFAULT_STATION_CAPACITY, cells);
      return {
        ...cell,
        potentialPeople: metrics.peopleReached,
        rankEfficiency: metrics.cost > 0 ? metrics.peopleReached / metrics.cost : 0,
        heatPriority: metrics.heatPriority,
      };
    });

  const ordered = [];
  const remaining = [...ranked];
  while (remaining.length) {
    remaining.sort((a, b) => b.rankEfficiency - a.rankEfficiency);
    const bandMaximum = remaining[0].rankEfficiency;
    const cutoff = bandMaximum * 0.95;
    const band = remaining
      .filter((candidate) => candidate.rankEfficiency >= cutoff)
      .sort((a, b) =>
        b.heatPriority - a.heatPriority
        || b.rankEfficiency - a.rankEfficiency
        || b.potentialPeople - a.potentialPeople
        || a.id.localeCompare(b.id));
    const bandIds = new Set(band.map((candidate) => candidate.id));
    ordered.push(...band);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (bandIds.has(remaining[index].id)) remaining.splice(index, 1);
    }
  }
  return ordered;
}

export function estimateCellPopulation(cell) {
  if (!cell || cell.outside || cell.water) return 0;
  if (Number.isFinite(cell.population)) return cell.population;
  const densityIndex = 0.68 * cell.vulnerable + 0.32 * cell.flow;
  return (35 + densityIndex * 720) * POPULATION_AREA_SCALE;
}

export function getPopulationReached(cells, placedStations = []) {
  if (!placedStations.length) return 0;
  return Math.round(getDemandState(cells, placedStations).servedByPlaced);
}

export function getCellMetrics(cell, capacity, cells, placedStations = []) {
  if (!cell) return {
    cost: 0,
    capacity: 0,
    protectedHours: 0,
    coveredCells: 0,
    peopleReached: 0,
    heatPriority: 0,
  };
  const covered = cells.filter(
    (other) =>
      !other.outside &&
      !other.water &&
      distanceBetweenCellCentresMetres(other, cell) <= FIXED_SERVICE_RADIUS,
  );
  const demand = covered.reduce(
    (sum, other) =>
      sum + other.heat * (0.58 * other.vulnerable + 0.42 * other.flow),
    0,
  );
  const cost = getStationCost(cell, capacity);
  const proposed = {
    id: cell.id,
    x: cell.x,
    y: cell.y,
    radius: FIXED_SERVICE_RADIUS,
    capacity,
    cost,
  };
  const beforeState = getDemandState(cells, placedStations);
  const afterState = getDemandState(cells, [...placedStations, proposed]);
  const before = beforeState.servedByPlaced;
  const after = afterState.servedByPlaced;
  let weightedHeat = 0;
  let weightedDemand = 0;
  for (const other of covered) {
    const index = other.y * GRID_COLS + other.x;
    const demandAmount = Math.max(0, beforeState.residual[index] ?? 0);
    weightedHeat += demandAmount * other.heat;
    weightedDemand += demandAmount;
  }

  return {
    cost,
    capacity,
    protectedHours: Math.round(demand * 240),
    coveredCells: covered.length,
    peopleReached: Math.round(Math.max(0, after - before)),
    heatPriority: weightedDemand > 0 ? weightedHeat / weightedDemand : 0,
  };
}

export function generateRandomSolution(candidateCells, cells, budget, random = Math.random) {
  const solution = [];
  const remainingCandidates = shuffled(candidateCells, random);
  let remainingBudget = budget;

  const placeRandomAffordableStation = (cell) => {
    const affordableCapacities = STATION_CAPACITIES.filter(
      (capacity) => getCellMetrics(cell, capacity, cells).cost <= remainingBudget,
    );
    if (!affordableCapacities.length) return false;
    const capacity = affordableCapacities[Math.floor(random() * affordableCapacities.length)];
    const { cost } = getCellMetrics(cell, capacity, cells);
    solution.push({
      id: cell.id,
      x: cell.x,
      y: cell.y,
      radius: FIXED_SERVICE_RADIUS,
      capacity,
      cost,
    });
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
        getCellMetrics(cell, STATION_CAPACITIES[0], cells).cost <= remainingBudget,
    );
    if (!affordable.length) break;
    placeRandomAffordableStation(affordable[Math.floor(random() * affordable.length)]);
  }

  return solution;
}
