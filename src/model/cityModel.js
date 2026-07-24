import queenstownGrid from "../data/queenstownGrid.json" with { type: "json" };

export const GRID_COLS = queenstownGrid.metadata.columns;
export const GRID_ROWS = queenstownGrid.metadata.rows;
export const CELL_SIZE_METRES = queenstownGrid.metadata.cellSizeMetres;
export const MAP_METADATA = queenstownGrid.metadata;
export const MAP_SUBZONES = queenstownGrid.subzones;
export const MAP_EXISTING_SHELTERS = queenstownGrid.existingShelters ?? [];
export const DEMAND_DENSITY_BANDWIDTH_METRES = 160;
export const STATION_RADII = [100, 150, 200, 250, 300];
export const STATION_CAPACITY_BY_RADIUS = {
  100: 500,
  150: 1000,
  200: 2000,
  250: 3000,
  300: 4500,
};
export const BASE_COST_BY_RADIUS = {
  100: 180_000,
  150: 240_000,
  200: 320_000,
  250: 410_000,
  300: 510_000,
};

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
    description: "Modelled heat exposure for the selected time and scenario.",
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

export function buildCity(time = "afternoon", scenario = "baseline") {
  const heatTimeBoost = time === "afternoon" ? 0.16 : time === "morning" ? -0.05 : 0.04;
  const flowTimeBoost = time === "evening" ? 0.12 : time === "morning" ? 0.08 : 0;
  const scenarioHeatBoost = scenario === "heatwave" ? 0.18 : 0;
  const scenarioFlowBoost = scenario === "high-growth" ? 0.18 : 0;
  const scenarioDemandMultiplier = scenario === "high-growth" ? 1.15 : 1;

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

const stationCapacity = (station) =>
  station.capacity ?? STATION_CAPACITY_BY_RADIUS[station.radius] ?? 0;

const applyShelterToDemand = (residual, available, heatExposure, shelter) => {
  let remainingCapacity = stationCapacity(shelter);
  let served = 0;
  const servedByCell = [];
  if (remainingCapacity <= 0) return { served, servedByCell };

  for (const band of getDistanceBands(shelter.radius ?? 100)) {
    const demandCells = [];
    let bandDemand = 0;
    for (const offset of band) {
      const x = shelter.x + offset.x;
      const y = shelter.y + offset.y;
      if (x < 0 || x >= GRID_COLS || y < 0 || y >= GRID_ROWS) continue;
      const index = y * GRID_COLS + x;
      if (!available[index] || residual[index] <= 0) continue;
      demandCells.push({
        index,
        demand: residual[index],
        heat: heatExposure[index],
      });
      bandDemand += residual[index];
    }
    if (bandDemand > remainingCapacity) {
      demandCells.sort((a, b) => b.heat - a.heat || a.index - b.index);
    }
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
      heatExposure,
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
  const servedByCell = new Float64Array(GRID_COLS * GRID_ROWS);
  const perStation = new Map();
  let servedByPlaced = 0;
  for (const station of placedStations) {
    const result = applyShelterToDemand(
      residual,
      baseline.available,
      baseline.heatExposure,
      station,
    );
    servedByPlaced += result.served;
    perStation.set(station.id, result.served);
    for (const item of result.servedByCell) servedByCell[item.index] += item.amount;
  }
  return {
    ...baseline,
    residual,
    servedByCell,
    servedByPlaced,
    perStation,
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
  return siteIds
    .map((id) => cellById.get(id))
    .filter(Boolean)
    .map((cell) => {
      const metrics = getCellMetrics(cell, 150, cells);
      return {
        ...cell,
        potentialPeople: metrics.peopleReached,
        rankEfficiency: metrics.cost > 0 ? metrics.peopleReached / metrics.cost : 0,
      };
    })
    .sort((a, b) =>
      b.rankEfficiency - a.rankEfficiency
      || b.potentialPeople - a.potentialPeople
      || a.id.localeCompare(b.id));
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

export function getCellMetrics(cell, radius, cells, placedStations = []) {
  if (!cell) return {
    cost: 0,
    capacity: 0,
    protectedHours: 0,
    coveredCells: 0,
    peopleReached: 0,
  };
  const covered = cells.filter(
    (other) =>
      !other.outside &&
      !other.water &&
      distanceBetweenCellCentresMetres(other, cell) <= radius,
  );
  const demand = covered.reduce(
    (sum, other) =>
      sum + other.heat * (0.58 * other.vulnerable + 0.42 * other.flow),
    0,
  );
  const housingCostIndex = Number.isFinite(cell.housingCostIndex) && cell.housingCostIndex > 0
    ? cell.housingCostIndex
    : 1;
  const cost = Math.round((BASE_COST_BY_RADIUS[radius] * housingCostIndex) / 1000) * 1000;
  const capacity = STATION_CAPACITY_BY_RADIUS[radius];
  const proposed = {
    id: cell.id,
    x: cell.x,
    y: cell.y,
    radius,
    capacity,
    cost,
  };
  const before = getDemandState(cells, placedStations).servedByPlaced;
  const after = getDemandState(cells, [...placedStations, proposed]).servedByPlaced;

  return {
    cost,
    capacity,
    protectedHours: Math.round(demand * 240),
    coveredCells: covered.length,
    peopleReached: Math.round(Math.max(0, after - before)),
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
    solution.push({
      id: cell.id,
      x: cell.x,
      y: cell.y,
      radius,
      capacity: STATION_CAPACITY_BY_RADIUS[radius],
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
        getCellMetrics(cell, STATION_RADII[0], cells).cost <= remainingBudget,
    );
    if (!affordable.length) break;
    placeRandomAffordableStation(affordable[Math.floor(random() * affordable.length)]);
  }

  return solution;
}
