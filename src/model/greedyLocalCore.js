const CELL_SIZE_METRES = 20;
const LOCAL_POOL_LIMIT = 700;
const LOCAL_PASSES = 2;
const GLOBAL_PRIORITY_POOL = 900;
const REFINEMENT_POOL_LIMIT = 24;
const SPATIAL_BLOCK_CELLS = 16;

const buildRings = (radius) => {
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
  return [...offsetsByDistance.entries()]
    .sort(([distanceA], [distanceB]) => distanceA - distanceB)
    .map(([, offsets]) => offsets);
};

const stationCost = (candidate, capacity, costModel) => {
  const localIndex = Number.isFinite(candidate.housingCostIndex) && candidate.housingCostIndex > 0
    ? candidate.housingCostIndex
    : 1;
  const regionalMultiplier = Math.min(
    costModel.maximumRegionalMultiplier,
    Math.max(costModel.minimumRegionalMultiplier, localIndex),
  );
  const baseCost = costModel.fixed
    + costModel.linear * capacity
    + costModel.quadratic * capacity ** 2;
  return Math.round((baseCost * regionalMultiplier) / 1000) * 1000;
};

export function solveGreedyLocal(input, { onProgress } = {}) {
  const {
    candidates,
    demandCells,
    budget,
    columns,
    rows,
    serviceRadius,
    capacityOptions,
    costModel,
    includeTrace = false,
    greedyOnly = false,
    fullTraversal = false,
  } = input;
  const serviceRings = buildRings(serviceRadius);
  const heatExposure = new Float32Array(columns * rows);
  const initialDemand = new Float64Array(columns * rows);
  for (const cell of demandCells) {
    const index = cell.y * columns + cell.x;
    heatExposure[index] = Math.max(0, cell.heat ?? 0);
    initialDemand[index] = Math.max(0, cell.population);
  }

  const evaluateStation = (candidate, capacity, residualDemand) => {
    let remainingCapacity = capacity;
    let gain = 0;
    let served = 0;
    for (const ring of serviceRings) {
      const ringCells = [];
      let ringDemand = 0;
      for (const offset of ring) {
        const x = candidate.x + offset.x;
        const y = candidate.y + offset.y;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const index = y * columns + x;
        const demand = residualDemand[index];
        if (demand <= 0) continue;
        ringCells.push({ index, demand, heat: heatExposure[index] });
        ringDemand += demand;
      }
      if (ringDemand > remainingCapacity) {
        ringCells.sort((a, b) => b.heat - a.heat || a.index - b.index);
      }
      for (const item of ringCells) {
        const amount = Math.min(item.demand, remainingCapacity);
        gain += amount;
        served += amount;
        remainingCapacity -= amount;
        if (remainingCapacity <= 1e-6) break;
      }
      if (remainingCapacity <= 1e-6) break;
    }
    return { gain, served };
  };

  const applyStation = (station, residualDemand) => {
    let remainingCapacity = station.capacity ?? 0;
    let gain = 0;
    let served = 0;
    for (const ring of serviceRings) {
      const ringCells = [];
      let ringDemand = 0;
      for (const offset of ring) {
        const x = station.x + offset.x;
        const y = station.y + offset.y;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const index = y * columns + x;
        const demand = residualDemand[index];
        if (demand <= 0) continue;
        ringCells.push({ index, demand, heat: heatExposure[index] });
        ringDemand += demand;
      }
      if (ringDemand > remainingCapacity) {
        ringCells.sort((a, b) => b.heat - a.heat || a.index - b.index);
      }
      for (const item of ringCells) {
        const amount = Math.min(item.demand, remainingCapacity);
        residualDemand[item.index] = Math.max(0, residualDemand[item.index] - amount);
        gain += amount;
        served += amount;
        remainingCapacity -= amount;
        if (remainingCapacity <= 1e-6) break;
      }
      if (remainingCapacity <= 1e-6) break;
    }
    return { gain, served };
  };

  const evaluateSolution = (solution) => {
    const residualDemand = initialDemand.slice();
    let value = 0;
    let population = 0;
    for (const station of solution) {
      const result = applyStation(station, residualDemand);
      value += result.gain;
      population += result.served;
    }
    return { residualDemand, value, population };
  };

  const candidatePriority = (candidate) =>
    (candidate.score + 1) / stationCost(candidate, capacityOptions[0], costModel);
  const preselectCandidates = () => {
    if (fullTraversal) return candidates;
    if (candidates.length <= GLOBAL_PRIORITY_POOL * 2) return candidates;
    const ranked = [...candidates].sort((a, b) => candidatePriority(b) - candidatePriority(a));
    const selectedById = new Map(
      ranked.slice(0, GLOBAL_PRIORITY_POOL).map((candidate) => [candidate.id, candidate]),
    );
    const bestByBlock = new Map();
    for (const candidate of candidates) {
      const key = `${Math.floor(candidate.x / SPATIAL_BLOCK_CELLS)}-${Math.floor(candidate.y / SPATIAL_BLOCK_CELLS)}`;
      const current = bestByBlock.get(key);
      if (!current || candidatePriority(candidate) > candidatePriority(current)) {
        bestByBlock.set(key, candidate);
      }
    }
    for (const candidate of bestByBlock.values()) selectedById.set(candidate.id, candidate);
    return [...selectedById.values()];
  };

  const searchCandidates = preselectCandidates();
  onProgress?.({
    phase: fullTraversal ? "traversal" : "screening",
    candidateCount: candidates.length,
    searchCount: searchCandidates.length,
  });

  const potentialById = new Map();
  const greedySteps = [];
  const extendGreedy = (initialSolution, collectPotential = false, recordSteps = false) => {
    const solution = [...initialSolution];
    const selectedIds = new Set(solution.map((station) => station.id));
    const state = evaluateSolution(solution);
    let spent = solution.reduce((sum, station) => sum + station.cost, 0);
    let iteration = solution.length;

    while (true) {
      const remainingBudget = budget - spent;
      let best = null;
      let evaluatedOptions = 0;
      for (const candidate of searchCandidates) {
        if (selectedIds.has(candidate.id)) continue;
        let bestCandidateDensity = 0;
        for (const capacity of capacityOptions) {
          const cost = stationCost(candidate, capacity, costModel);
          if (cost > remainingBudget) continue;
          evaluatedOptions += 1;
          const result = evaluateStation(candidate, capacity, state.residualDemand);
          const density = result.gain / cost;
          if (collectPotential && density > bestCandidateDensity) bestCandidateDensity = density;
          if (
            result.gain > 0
            && (!best || density > best.density
              || (density === best.density && result.gain > best.gain))
          ) {
            best = {
              ...candidate,
              radius: serviceRadius,
              capacity,
              cost,
              gain: result.gain,
              served: result.served,
              density,
            };
          }
        }
        if (collectPotential && bestCandidateDensity > 0) {
          potentialById.set(candidate.id, Math.max(
            potentialById.get(candidate.id) ?? 0,
            bestCandidateDensity,
          ));
        }
      }
      if (!best) break;
      const station = {
        id: best.id,
        x: best.x,
        y: best.y,
        radius: best.radius,
        capacity: best.capacity,
        cost: best.cost,
      };
      solution.push(station);
      selectedIds.add(best.id);
      spent += best.cost;
      const applied = applyStation(station, state.residualDemand);
      state.value += applied.gain;
      state.population += applied.served;
      iteration += 1;
      if (recordSteps) {
        greedySteps.push({
          iteration,
          station,
          marginalGain: Math.round(applied.gain),
          peopleServed: Math.round(applied.served),
          efficiency: Math.round(best.density * 100000),
          totalScore: Math.round(state.value),
          spent,
          remainingBudget: budget - spent,
          evaluatedOptions,
        });
      }
      onProgress?.({
        phase: "greedy",
        iteration,
        score: Math.round(state.value),
        population: Math.round(state.population),
      });
    }
    return { solution, ...state };
  };

  let result = extendGreedy([], true, includeTrace);
  const candidateById = new Map(searchCandidates.map((candidate) => [candidate.id, candidate]));
  const localPoolIds = [...potentialById.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(LOCAL_POOL_LIMIT, searchCandidates.length))
    .map(([candidateId]) => candidateId);
  for (const station of result.solution) {
    if (!localPoolIds.includes(station.id)) localPoolIds.push(station.id);
  }
  const localPool = localPoolIds
    .map((candidateId) => candidateById.get(candidateId))
    .filter(Boolean);

  for (let pass = 0; pass < (greedyOnly ? 0 : LOCAL_PASSES); pass += 1) {
    let bestMove = null;
    for (let removeIndex = 0; removeIndex < result.solution.length; removeIndex += 1) {
      const reducedSolution = result.solution.filter((_, index) => index !== removeIndex);
      const reducedIds = new Set(reducedSolution.map((station) => station.id));
      const reduced = evaluateSolution(reducedSolution);
      const reducedCost = reducedSolution.reduce((sum, station) => sum + station.cost, 0);
      for (const candidate of localPool) {
        if (reducedIds.has(candidate.id)) continue;
        for (const capacity of capacityOptions) {
          const cost = stationCost(candidate, capacity, costModel);
          if (reducedCost + cost > budget) continue;
          const option = evaluateStation(candidate, capacity, reduced.residualDemand);
          const value = reduced.value + option.gain;
          if (value > result.value + 0.5 && (!bestMove || value > bestMove.value)) {
            bestMove = {
              value,
              solution: [...reducedSolution, {
                id: candidate.id,
                x: candidate.x,
                y: candidate.y,
                radius: serviceRadius,
                capacity,
                cost,
              }],
            };
          }
        }
      }
    }
    if (!bestMove) break;
    result = extendGreedy(bestMove.solution);
    onProgress?.({
      phase: "local",
      iteration: pass + 1,
      score: Math.round(result.value),
    });
  }

  const refinementIds = [
    ...new Set([
      ...result.solution.map((station) => station.id),
      ...[...potentialById.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, REFINEMENT_POOL_LIMIT)
        .map(([candidateId]) => candidateId),
    ]),
  ];

  return {
    steps: includeTrace ? greedySteps : undefined,
    refinementIds: fullTraversal ? refinementIds : undefined,
    solution: result.solution,
  };
}
