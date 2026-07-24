const CELL_SIZE_METRES = 20;
const EPSILON = 1e-8;
const COST_UNIT = 1000;
const DEFAULT_CAPACITIES = { 100: 500, 150: 1000, 200: 2000, 250: 3000, 300: 4500 };
const DEFAULT_BASE_COSTS = { 100: 180000, 150: 240000, 200: 320000, 250: 410000, 300: 510000 };

const ringCache = new Map();
const buildRings = (radii) => {
  const key = radii.join(",");
  if (ringCache.has(key)) return ringCache.get(key);
  const result = new Map(radii.map((radius) => {
    const reach = Math.ceil(radius / CELL_SIZE_METRES);
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
    const rings = [...offsetsByDistance.entries()]
      .sort(([distanceA], [distanceB]) => distanceA - distanceB)
      .map(([, offsets]) => offsets);
    return [radius, rings];
  }));
  ringCache.set(key, result);
  return result;
};

const stationCost = (candidate, radius, baseCosts) => {
  const localIndex = Number.isFinite(candidate.housingCostIndex) && candidate.housingCostIndex > 0
    ? candidate.housingCostIndex
    : 1;
  return Math.round((baseCosts[radius] * localIndex) / 1000) * 1000;
};

const isBetter = (score, population, spent, incumbent) => {
  if (score > incumbent.score + EPSILON) return true;
  if (Math.abs(score - incumbent.score) > EPSILON) return false;
  if (population > incumbent.population + EPSILON) return true;
  if (Math.abs(population - incumbent.population) > EPSILON) return false;
  return spent < incumbent.spent;
};

export function solveExactOptimal({
  candidates,
  demandCells,
  budget,
  columns,
  rows,
  radii,
  capacities = DEFAULT_CAPACITIES,
  baseCosts = DEFAULT_BASE_COSTS,
  onProgress,
}) {
  const startedAt = performance.now();
  const gridSize = columns * rows;
  const heatExposure = new Float32Array(gridSize);
  const initialDemand = new Float64Array(gridSize);
  for (const cell of demandCells) {
    const index = cell.y * columns + cell.x;
    heatExposure[index] = Math.max(0, cell.heat ?? 0);
    initialDemand[index] = Math.max(0, cell.population);
  }
  const ringsByRadius = buildRings(radii);

  const evaluateOption = (option, residual) => {
    let remainingCapacity = option.capacity;
    let score = 0;
    let population = 0;
    for (const ring of option.rings) {
      for (const index of ring) {
        const demand = residual[index];
        if (demand <= 0) continue;
        const amount = Math.min(demand, remainingCapacity);
        score += amount;
        population += amount;
        remainingCapacity -= amount;
        if (remainingCapacity <= EPSILON) break;
      }
      if (remainingCapacity <= EPSILON) break;
    }
    return { score, population };
  };

  const applyOption = (option, residual) => {
    let remainingCapacity = option.capacity;
    let score = 0;
    let population = 0;
    const changes = [];
    for (const ring of option.rings) {
      for (const index of ring) {
        const demand = residual[index];
        if (demand <= 0) continue;
        const amount = Math.min(demand, remainingCapacity);
        changes.push({ index, previous: demand });
        residual[index] = Math.max(0, demand - amount);
        score += amount;
        population += amount;
        remainingCapacity -= amount;
        if (remainingCapacity <= EPSILON) break;
      }
      if (remainingCapacity <= EPSILON) break;
    }
    return { score, population, changes };
  };

  const rollback = (change, residual) => {
    for (const item of change.changes) residual[item.index] = item.previous;
  };

  const rawGroups = candidates.map((candidate) => {
    const options = [];
    for (const radius of radii) {
      const cost = stationCost(candidate, radius, baseCosts);
      if (cost > budget) continue;
      const rings = ringsByRadius.get(radius).map((ring) => ring
        .map((offset) => {
          const x = candidate.x + offset.x;
          const y = candidate.y + offset.y;
          return x < 0 || x >= columns || y < 0 || y >= rows
            ? -1
            : y * columns + x;
        })
        .filter((index) => index >= 0 && initialDemand[index] > 0)
        .sort((a, b) => heatExposure[b] - heatExposure[a] || a - b));
      const option = {
        id: candidate.id,
        x: candidate.x,
        y: candidate.y,
        radius,
        capacity: capacities[radius],
        cost,
        rings,
      };
      const standalone = evaluateOption(option, initialDemand);
      if (standalone.score <= EPSILON && standalone.population <= EPSILON) continue;
      option.standaloneScore = standalone.score;
      option.standalonePopulation = standalone.population;
      options.push(option);
    }
    options.sort((a, b) => a.cost - b.cost);
    const nonDominated = options.filter((option, index) => !options.slice(0, index).some((other) =>
      other.cost <= option.cost
      && other.standaloneScore >= option.standaloneScore - EPSILON
      && other.standalonePopulation >= option.standalonePopulation - EPSILON));
    return {
      candidate,
      options: nonDominated,
      maxScore: Math.max(0, ...nonDominated.map((option) => option.standaloneScore)),
      maxPopulation: Math.max(0, ...nonDominated.map((option) => option.standalonePopulation)),
      minCost: Math.min(Infinity, ...nonDominated.map((option) => option.cost)),
    };
  }).filter((group) => group.options.length);

  const groups = rawGroups;
  const budgetUnits = Math.floor(budget / COST_UNIT);
  const buildSuffixUpper = (field) => {
    const suffix = Array.from(
      { length: groups.length + 1 },
      () => new Float64Array(budgetUnits + 1),
    );
    for (let depth = groups.length - 1; depth >= 0; depth -= 1) {
      const current = suffix[depth];
      const next = suffix[depth + 1];
      const group = groups[depth];
      for (let units = 0; units <= budgetUnits; units += 1) {
        let best = next[units];
        for (const option of group.options) {
          const optionUnits = Math.ceil(option.cost / COST_UNIT);
          if (optionUnits > units) continue;
          const value = field === "score"
            ? option.standaloneScore
            : option.standalonePopulation;
          best = Math.max(best, value + next[units - optionUnits]);
        }
        current[units] = best;
      }
    }
    return suffix;
  };
  const scoreSuffixUpper = buildSuffixUpper("score");
  const populationSuffixUpper = buildSuffixUpper("population");

  const greedySeed = (preferGain = false) => {
    const residual = initialDemand.slice();
    const selected = new Set();
    const solution = [];
    let score = 0;
    let population = 0;
    let spent = 0;
    while (true) {
      let best = null;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        if (selected.has(groupIndex)) continue;
        for (const option of groups[groupIndex].options) {
          if (spent + option.cost > budget) continue;
          const gain = evaluateOption(option, residual);
          const density = gain.score / option.cost;
          if (!best || (preferGain
            ? gain.score > best.gain.score + EPSILON
              || (Math.abs(gain.score - best.gain.score) <= EPSILON && density > best.density)
            : density > best.density + EPSILON
              || (Math.abs(density - best.density) <= EPSILON && gain.score > best.gain.score))) {
            best = { groupIndex, option, gain, density };
          }
        }
      }
      if (!best || best.gain.score <= EPSILON) break;
      const change = applyOption(best.option, residual);
      selected.add(best.groupIndex);
      solution.push({ ...best.option, groupIndex: best.groupIndex });
      score += change.score;
      population += change.population;
      spent += best.option.cost;
    }
    const canonicalSolution = solution
      .sort((a, b) => a.groupIndex - b.groupIndex)
      .map(({ groupIndex: _groupIndex, ...option }) => option);
    const canonicalResidual = initialDemand.slice();
    let canonicalScore = 0;
    let canonicalPopulation = 0;
    for (const option of canonicalSolution) {
      const result = applyOption(option, canonicalResidual);
      canonicalScore += result.score;
      canonicalPopulation += result.population;
    }
    return {
      score: canonicalScore,
      population: canonicalPopulation,
      spent,
      solution: canonicalSolution,
    };
  };

  const densitySeed = greedySeed(false);
  const gainSeed = greedySeed(true);
  let incumbent = isBetter(
    gainSeed.score,
    gainSeed.population,
    gainSeed.spent,
    densitySeed,
  ) ? gainSeed : densitySeed;
  const initialObjective = incumbent.score;

  const residual = initialDemand.slice();
  const selection = [];
  let nodes = 0;
  let pruned = 0;
  let lastProgressAt = 0;

  const reportProgress = (force = false) => {
    const now = performance.now();
    if (!force && now - lastProgressAt < 180) return;
    lastProgressAt = now;
    onProgress?.({
      phase: "exact",
      nodes,
      pruned,
      bestScore: Math.round(incumbent.score),
      elapsedMs: Math.round(now - startedAt),
    });
  };

  const updateIncumbent = (score, population, spent) => {
    if (!isBetter(score, population, spent, incumbent)) return;
    incumbent = { score, population, spent, solution: [...selection] };
    reportProgress(true);
  };

  const upperBound = (depth, remainingBudget, field) => {
    const units = Math.max(0, Math.min(
      budgetUnits,
      Math.floor(remainingBudget / COST_UNIT),
    ));
    return field === "score"
      ? scoreSuffixUpper[depth][units]
      : populationSuffixUpper[depth][units];
  };

  const search = (depth, spent, score, population) => {
    nodes += 1;
    if ((nodes & 2047) === 0) reportProgress();
    updateIncumbent(score, population, spent);
    if (depth >= groups.length) return;
    const remainingBudget = budget - spent;
    const scoreBound = score + upperBound(depth, remainingBudget, "score");
    if (scoreBound < incumbent.score - EPSILON) {
      pruned += 1;
      return;
    }
    if (scoreBound <= incumbent.score + EPSILON) {
      const populationBound = population + upperBound(depth, remainingBudget, "population");
      if (populationBound <= incumbent.population + EPSILON) {
        pruned += 1;
        return;
      }
    }

    const group = groups[depth];
    const branches = group.options
      .filter((option) => option.cost <= remainingBudget)
      .map((option) => ({ option, gain: evaluateOption(option, residual) }))
      .filter(({ gain }) => gain.score > EPSILON || gain.population > EPSILON)
      .sort((a, b) =>
        b.gain.score / b.option.cost - a.gain.score / a.option.cost
        || b.gain.score - a.gain.score
        || b.gain.population - a.gain.population);

    for (const { option } of branches) {
      const change = applyOption(option, residual);
      selection.push(option);
      search(
        depth + 1,
        spent + option.cost,
        score + change.score,
        population + change.population,
      );
      selection.pop();
      rollback(change, residual);
    }
    search(depth + 1, spent, score, population);
  };

  reportProgress(true);
  search(0, 0, 0, 0);
  reportProgress(true);

  return {
    solution: incumbent.solution.map(({ id, x, y, radius, capacity, cost }) => ({
      id,
      x,
      y,
      radius,
      capacity,
      cost,
    })),
    stats: {
      optimal: true,
      objective: Math.round(incumbent.score),
      initialObjective: Math.round(initialObjective),
      population: Math.round(incumbent.population),
      spent: incumbent.spent,
      nodes,
      pruned,
      candidateCount: groups.length,
      optionCount: groups.reduce((sum, group) => sum + group.options.length, 0),
      elapsedMs: Math.round(performance.now() - startedAt),
      allocationRule: "capacity-centre-outward-euclidean-heat-tiebreak",
    },
  };
}
