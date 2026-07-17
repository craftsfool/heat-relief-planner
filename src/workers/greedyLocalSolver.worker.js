const CELL_SIZE_METRES = 20;
const CELL_HALF_DIAGONAL = Math.SQRT2 / 2;
const LOCAL_POOL_LIMIT = 700;
const LOCAL_PASSES = 2;
const GLOBAL_PRIORITY_POOL = 900;
const SPATIAL_BLOCK_CELLS = 16;

const buildOffsets = (radii) => new Map(radii.map((radius) => {
  const radiusInCells = radius / CELL_SIZE_METRES;
  const reach = Math.ceil(radiusInCells + 1);
  const offsets = [];
  for (let offsetY = -reach; offsetY <= reach; offsetY += 1) {
    for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
      const distance = Math.max(0, Math.hypot(offsetX, offsetY) - CELL_HALF_DIAGONAL);
      if (distance > radiusInCells) continue;
      offsets.push({
        x: offsetX,
        y: offsetY,
        coverage: Math.max(0, 1 - distance / radiusInCells),
      });
    }
  }
  return [radius, offsets];
}));

const stationCost = (candidate, radius) => {
  const landFactor = 0.45 + 0.55 * candidate.flow;
  return Math.round((160000 + radius * 650 + landFactor * 85000) / 1000) * 1000;
};

self.onmessage = ({ data }) => {
  const {
    id,
    candidates,
    demandCells,
    budget,
    columns,
    rows,
    radii,
    scoreReduction,
    includeTrace = false,
    greedyOnly = false,
  } = data;

  try {
    const offsetsByRadius = buildOffsets(radii);
    const baseScores = new Float32Array(columns * rows);
    for (const cell of demandCells) baseScores[cell.y * columns + cell.x] = cell.score;

    const candidatePriority = (candidate) =>
      (candidate.score + 1) / stationCost(candidate, radii[0]);
    const preselectCandidates = () => {
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
    self.postMessage({
      id,
      progress: {
        phase: "screening",
        candidateCount: candidates.length,
        searchCount: searchCandidates.length,
      },
    });

    const marginalGain = (candidate, radius, coverageState) => {
      let gain = 0;
      for (const offset of offsetsByRadius.get(radius)) {
        const x = candidate.x + offset.x;
        const y = candidate.y + offset.y;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const index = y * columns + x;
        const baseScore = baseScores[index];
        if (baseScore <= 0 || offset.coverage <= coverageState[index]) continue;
        const previous = Math.min(baseScore, scoreReduction * coverageState[index]);
        const next = Math.min(baseScore, scoreReduction * offset.coverage);
        gain += next - previous;
      }
      return gain;
    };

    const applyStation = (candidate, radius, coverageState) => {
      for (const offset of offsetsByRadius.get(radius)) {
        const x = candidate.x + offset.x;
        const y = candidate.y + offset.y;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const index = y * columns + x;
        if (baseScores[index] > 0 && offset.coverage > coverageState[index]) {
          coverageState[index] = offset.coverage;
        }
      }
    };

    const buildCoverage = (solution) => {
      const coverageState = new Float32Array(columns * rows);
      for (const station of solution) applyStation(station, station.radius, coverageState);
      return coverageState;
    };

    const coverageValue = (coverageState) => {
      let value = 0;
      for (let index = 0; index < baseScores.length; index += 1) {
        if (baseScores[index] > 0 && coverageState[index] > 0) {
          value += Math.min(baseScores[index], scoreReduction * coverageState[index]);
        }
      }
      return value;
    };

    const potentialById = new Map();
    const greedySteps = [];
    const extendGreedy = (initialSolution, collectPotential = false, recordSteps = false) => {
      const solution = [...initialSolution];
      const selectedIds = new Set(solution.map((station) => station.id));
      const coverageState = buildCoverage(solution);
      let spent = solution.reduce((sum, station) => sum + station.cost, 0);
      let iteration = solution.length;

      while (true) {
        const remainingBudget = budget - spent;
        let best = null;
        let evaluatedOptions = 0;
        for (const candidate of searchCandidates) {
          if (selectedIds.has(candidate.id)) continue;
          let bestCandidateDensity = 0;
          for (const radius of radii) {
            const cost = stationCost(candidate, radius);
            if (cost > remainingBudget) continue;
            evaluatedOptions += 1;
            const gain = marginalGain(candidate, radius, coverageState);
            const density = gain / cost;
            if (collectPotential && density > bestCandidateDensity) bestCandidateDensity = density;
            if (
              gain > 0 &&
              (!best || density > best.density || (density === best.density && gain > best.gain))
            ) {
              best = { ...candidate, radius, cost, gain, density };
            }
          }
          if (collectPotential && bestCandidateDensity > 0) {
            potentialById.set(candidate.id, Math.max(potentialById.get(candidate.id) ?? 0, bestCandidateDensity));
          }
        }
        if (!best) break;
        solution.push({ id: best.id, x: best.x, y: best.y, flow: best.flow, radius: best.radius, cost: best.cost });
        selectedIds.add(best.id);
        spent += best.cost;
        applyStation(best, best.radius, coverageState);
        iteration += 1;
        const totalScore = Math.round(coverageValue(coverageState));
        if (recordSteps) {
          greedySteps.push({
            iteration,
            station: {
              id: best.id,
              x: best.x,
              y: best.y,
              radius: best.radius,
              cost: best.cost,
            },
            marginalGain: Math.round(best.gain),
            efficiency: Math.round(best.density * 100000),
            totalScore,
            spent,
            remainingBudget: budget - spent,
            evaluatedOptions,
          });
        }
        self.postMessage({ id, progress: { phase: "greedy", iteration, score: totalScore } });
      }
      return { solution, coverageState, value: coverageValue(coverageState) };
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
    const localPool = localPoolIds.map((candidateId) => candidateById.get(candidateId)).filter(Boolean);

    for (let pass = 0; pass < (greedyOnly ? 0 : LOCAL_PASSES); pass += 1) {
      let bestMove = null;
      for (let removeIndex = 0; removeIndex < result.solution.length; removeIndex += 1) {
        const reducedSolution = result.solution.filter((_, index) => index !== removeIndex);
        const reducedIds = new Set(reducedSolution.map((station) => station.id));
        const reducedCoverage = buildCoverage(reducedSolution);
        const reducedValue = coverageValue(reducedCoverage);
        const reducedCost = reducedSolution.reduce((sum, station) => sum + station.cost, 0);

        for (const candidate of localPool) {
          if (reducedIds.has(candidate.id)) continue;
          for (const radius of radii) {
            const cost = stationCost(candidate, radius);
            if (reducedCost + cost > budget) continue;
            const value = reducedValue + marginalGain(candidate, radius, reducedCoverage);
            if (value > result.value + 0.5 && (!bestMove || value > bestMove.value)) {
              bestMove = {
                value,
                solution: [...reducedSolution, {
                  id: candidate.id,
                  x: candidate.x,
                  y: candidate.y,
                  flow: candidate.flow,
                  radius,
                  cost,
                }],
              };
            }
          }
        }
      }

      if (!bestMove) break;
      result = extendGreedy(bestMove.solution);
      self.postMessage({ id, progress: { phase: "local", iteration: pass + 1, score: Math.round(result.value) } });
    }

    self.postMessage({
      id,
      steps: includeTrace ? greedySteps : undefined,
      solution: result.solution.map(({ id: stationId, x, y, radius, cost }) => ({
        id: stationId,
        x,
        y,
        radius,
        cost,
      })),
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
