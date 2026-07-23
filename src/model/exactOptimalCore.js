const CELL_SIZE_METRES = 20;
const CELL_HALF_DIAGONAL = Math.SQRT2 / 2;
const COST_UNIT = 1000;
const EPSILON = 1e-8;
const DYNAMIC_BOUND_REMAINING = 9;

const offsetCache = new Map();

const buildOffsets = (radii) => {
  const key = radii.join(",");
  const cached = offsetCache.get(key);
  if (cached) return cached;

  const offsets = new Map(radii.map((radius) => {
    const radiusInCells = radius / CELL_SIZE_METRES;
    const reach = Math.ceil(radiusInCells + 1);
    const values = [];
    for (let offsetY = -reach; offsetY <= reach; offsetY += 1) {
      for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
        const distance = Math.max(0, Math.hypot(offsetX, offsetY) - CELL_HALF_DIAGONAL);
        if (distance > radiusInCells) continue;
        values.push({
          x: offsetX,
          y: offsetY,
          coverage: Math.max(0, 1 - distance / radiusInCells),
        });
      }
    }
    return [radius, values];
  }));
  offsetCache.set(key, offsets);
  return offsets;
};

const stationCost = (candidate, radius) => {
  const landFactor = 0.45 + 0.55 * candidate.flow;
  return Math.round((160000 + radius * 650 + landFactor * 85000) / 1000) * 1000;
};

const fractionalUpper = (items, budget) => {
  if (budget <= 0 || !items.length) return 0;
  const ranked = items
    .filter((item) => item.value > EPSILON && item.cost > 0)
    .sort((a, b) => b.value / b.cost - a.value / a.cost);
  let remaining = budget;
  let value = 0;
  for (const item of ranked) {
    if (item.cost <= remaining) {
      value += item.value;
      remaining -= item.cost;
      continue;
    }
    value += item.value * (remaining / item.cost);
    break;
  }
  return value;
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
  scoreReduction,
  onProgress,
}) {
  const startedAt = performance.now();
  const offsetsByRadius = buildOffsets(radii);
  const gridSize = columns * rows;
  const baseScores = new Float64Array(gridSize);
  const populations = new Float64Array(gridSize);

  for (const cell of demandCells) {
    const index = cell.y * columns + cell.x;
    baseScores[index] = Math.max(0, cell.score);
    populations[index] = Math.max(0, cell.population);
  }

  const rawGroups = candidates.map((candidate) => {
    const options = [];
    for (const radius of radii) {
      const cost = stationCost(candidate, radius);
      if (cost > budget) continue;
      const gridIndices = [];
      const coverages = [];
      let standaloneScore = 0;
      let standalonePopulation = 0;

      for (const offset of offsetsByRadius.get(radius)) {
        const x = candidate.x + offset.x;
        const y = candidate.y + offset.y;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const gridIndex = y * columns + x;
        if (baseScores[gridIndex] <= 0 && populations[gridIndex] <= 0) continue;
        gridIndices.push(gridIndex);
        coverages.push(offset.coverage);
        standaloneScore += Math.min(baseScores[gridIndex], scoreReduction * offset.coverage);
        standalonePopulation += populations[gridIndex] * offset.coverage;
      }

      if (standaloneScore > EPSILON || standalonePopulation > EPSILON) {
        options.push({
          id: candidate.id,
          x: candidate.x,
          y: candidate.y,
          radius,
          cost,
          costUnits: Math.ceil(cost / COST_UNIT),
          gridIndices,
          coverages,
          standaloneScore,
          standalonePopulation,
        });
      }
    }
    return { candidate, options };
  }).filter((group) => group.options.length > 0);

  const compactByGrid = new Int32Array(gridSize);
  compactByGrid.fill(-1);
  const compactGridIndices = [];
  for (const group of rawGroups) {
    for (const option of group.options) {
      for (const gridIndex of option.gridIndices) {
        if (compactByGrid[gridIndex] >= 0) continue;
        compactByGrid[gridIndex] = compactGridIndices.length;
        compactGridIndices.push(gridIndex);
      }
    }
  }

  const compactScores = new Float64Array(compactGridIndices.length);
  const compactPopulations = new Float64Array(compactGridIndices.length);
  compactGridIndices.forEach((gridIndex, compactIndex) => {
    compactScores[compactIndex] = baseScores[gridIndex];
    compactPopulations[compactIndex] = populations[gridIndex];
  });

  const groups = rawGroups.map(({ candidate, options }) => {
    const compactOptions = options.map((option) => ({
      ...option,
      indices: Int32Array.from(option.gridIndices.map((gridIndex) => compactByGrid[gridIndex])),
      coverages: Float64Array.from(option.coverages),
      gridIndices: undefined,
    }));
    const maxStandaloneScore = Math.max(...compactOptions.map((option) => option.standaloneScore));
    const maxStandalonePopulation = Math.max(...compactOptions.map((option) => option.standalonePopulation));
    const minCost = Math.min(...compactOptions.map((option) => option.cost));
    return {
      candidate,
      options: compactOptions,
      maxStandaloneScore,
      maxStandalonePopulation,
      minCost,
    };
  }).sort((a, b) => (
    b.maxStandaloneScore / b.minCost - a.maxStandaloneScore / a.minCost
    || b.maxStandalonePopulation / b.minCost - a.maxStandalonePopulation / a.minCost
    || b.maxStandaloneScore - a.maxStandaloneScore
  ));

  const marginalGain = (option, coverage) => {
    let score = 0;
    let population = 0;
    for (let index = 0; index < option.indices.length; index += 1) {
      const compactIndex = option.indices[index];
      const nextCoverage = option.coverages[index];
      const previousCoverage = coverage[compactIndex];
      if (nextCoverage <= previousCoverage) continue;
      score += Math.min(compactScores[compactIndex], scoreReduction * nextCoverage)
        - Math.min(compactScores[compactIndex], scoreReduction * previousCoverage);
      population += compactPopulations[compactIndex] * (nextCoverage - previousCoverage);
    }
    return { score, population };
  };

  const applyOption = (option, coverage) => {
    const changedIndices = [];
    const previousValues = [];
    let score = 0;
    let population = 0;
    for (let index = 0; index < option.indices.length; index += 1) {
      const compactIndex = option.indices[index];
      const nextCoverage = option.coverages[index];
      const previousCoverage = coverage[compactIndex];
      if (nextCoverage <= previousCoverage) continue;
      changedIndices.push(compactIndex);
      previousValues.push(previousCoverage);
      coverage[compactIndex] = nextCoverage;
      score += Math.min(compactScores[compactIndex], scoreReduction * nextCoverage)
        - Math.min(compactScores[compactIndex], scoreReduction * previousCoverage);
      population += compactPopulations[compactIndex] * (nextCoverage - previousCoverage);
    }
    return { score, population, changedIndices, previousValues };
  };

  const rollbackOption = (change, coverage) => {
    for (let index = 0; index < change.changedIndices.length; index += 1) {
      coverage[change.changedIndices[index]] = change.previousValues[index];
    }
  };

  const greedySeed = (strategy) => {
    const coverage = new Float64Array(compactGridIndices.length);
    const selectedGroupIndices = new Set();
    const solution = [];
    let score = 0;
    let population = 0;
    let spent = 0;

    while (true) {
      let best = null;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        if (selectedGroupIndices.has(groupIndex)) continue;
        for (const option of groups[groupIndex].options) {
          if (spent + option.cost > budget) continue;
          const gain = marginalGain(option, coverage);
          if (gain.score <= EPSILON && gain.population <= EPSILON) continue;
          const density = gain.score / option.cost;
          const populationDensity = gain.population / option.cost;
          const preferred = !best || (
            strategy === "gain"
              ? gain.score > best.gain.score + EPSILON
                || (Math.abs(gain.score - best.gain.score) <= EPSILON && density > best.density)
              : density > best.density + EPSILON
                || (Math.abs(density - best.density) <= EPSILON && gain.score > best.gain.score)
          ) || (
            best
            && Math.abs(gain.score - best.gain.score) <= EPSILON
            && Math.abs(density - best.density) <= EPSILON
            && populationDensity > best.populationDensity
          );
          if (preferred) {
            best = { groupIndex, option, gain, density, populationDensity };
          }
        }
      }
      if (!best) break;
      const change = applyOption(best.option, coverage);
      score += change.score;
      population += change.population;
      spent += best.option.cost;
      selectedGroupIndices.add(best.groupIndex);
      solution.push(best.option);
    }

    return { score, population, spent, solution };
  };

  const densitySeed = greedySeed("density");
  const gainSeed = greedySeed("gain");
  let incumbent = isBetter(
    gainSeed.score,
    gainSeed.population,
    gainSeed.spent,
    densitySeed,
  ) ? gainSeed : densitySeed;
  const initialObjective = incumbent.score;

  const suffixCoverage = new Array(groups.length + 1);
  suffixCoverage[groups.length] = new Float64Array(compactGridIndices.length);
  for (let depth = groups.length - 1; depth >= 0; depth -= 1) {
    const values = suffixCoverage[depth + 1].slice();
    for (const option of groups[depth].options) {
      for (let index = 0; index < option.indices.length; index += 1) {
        const compactIndex = option.indices[index];
        values[compactIndex] = Math.max(values[compactIndex], option.coverages[index]);
      }
    }
    suffixCoverage[depth] = values;
  }

  const suffixMinimumCost = new Float64Array(groups.length + 1);
  suffixMinimumCost[groups.length] = Number.POSITIVE_INFINITY;
  for (let depth = groups.length - 1; depth >= 0; depth -= 1) {
    suffixMinimumCost[depth] = Math.min(groups[depth].minCost, suffixMinimumCost[depth + 1]);
  }

  const budgetUnits = Math.floor(budget / COST_UNIT);
  const suffixScoreBudget = new Array(groups.length + 1);
  const suffixPopulationBudget = new Array(groups.length + 1);
  suffixScoreBudget[groups.length] = new Float64Array(budgetUnits + 1);
  suffixPopulationBudget[groups.length] = new Float64Array(budgetUnits + 1);
  for (let depth = groups.length - 1; depth >= 0; depth -= 1) {
    const nextScore = suffixScoreBudget[depth + 1];
    const nextPopulation = suffixPopulationBudget[depth + 1];
    const scoreValues = nextScore.slice();
    const populationValues = nextPopulation.slice();
    for (let available = 0; available <= budgetUnits; available += 1) {
      for (const option of groups[depth].options) {
        if (option.costUnits > available) continue;
        scoreValues[available] = Math.max(
          scoreValues[available],
          option.standaloneScore + nextScore[available - option.costUnits],
        );
        populationValues[available] = Math.max(
          populationValues[available],
          option.standalonePopulation + nextPopulation[available - option.costUnits],
        );
      }
    }
    suffixScoreBudget[depth] = scoreValues;
    suffixPopulationBudget[depth] = populationValues;
  }

  const coverageUpper = (depth, coverage) => {
    const optimisticCoverage = suffixCoverage[depth];
    let score = 0;
    let population = 0;
    for (let index = 0; index < coverage.length; index += 1) {
      const value = Math.max(coverage[index], optimisticCoverage[index]);
      score += Math.min(compactScores[index], scoreReduction * value);
      population += compactPopulations[index] * value;
    }
    return { score, population };
  };

  const dynamicBudgetUpper = (depth, remainingBudget, coverage, score, population) => {
    const scoreItems = [];
    const populationItems = [];
    for (let groupIndex = depth; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const envelopeOption = group.options[group.options.length - 1];
      const gain = marginalGain(envelopeOption, coverage);
      scoreItems.push({ value: gain.score, cost: group.minCost });
      populationItems.push({ value: gain.population, cost: group.minCost });
    }
    return {
      score: score + fractionalUpper(scoreItems, remainingBudget),
      population: population + fractionalUpper(populationItems, remainingBudget),
    };
  };

  const coverage = new Float64Array(compactGridIndices.length);
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
    incumbent = {
      score,
      population,
      spent,
      solution: [...selection],
    };
    reportProgress(true);
  };

  const search = (depth, spent, score, population) => {
    nodes += 1;
    if ((nodes & 2047) === 0) reportProgress();
    updateIncumbent(score, population, spent);
    if (depth >= groups.length) return;

    const remainingBudget = budget - spent;
    if (remainingBudget < suffixMinimumCost[depth]) return;

    const remainingUnits = Math.floor(remainingBudget / COST_UNIT);
    const budgetBound = {
      score: score + suffixScoreBudget[depth][remainingUnits],
      population: population + suffixPopulationBudget[depth][remainingUnits],
    };
    if (budgetBound.score < incumbent.score - EPSILON) {
      pruned += 1;
      return;
    }

    const spatialBound = coverageUpper(depth, coverage);
    let scoreBound = Math.min(budgetBound.score, spatialBound.score);
    let populationBound = Math.min(budgetBound.population, spatialBound.population);

    if (groups.length - depth <= DYNAMIC_BOUND_REMAINING) {
      const dynamicBound = dynamicBudgetUpper(depth, remainingBudget, coverage, score, population);
      scoreBound = Math.min(scoreBound, dynamicBound.score);
      populationBound = Math.min(populationBound, dynamicBound.population);
    }

    if (
      scoreBound < incumbent.score - EPSILON
      || (
        scoreBound <= incumbent.score + EPSILON
        && populationBound <= incumbent.population + EPSILON
      )
    ) {
      pruned += 1;
      return;
    }

    const branchOptions = groups[depth].options
      .filter((option) => option.cost <= remainingBudget)
      .map((option) => ({ option, gain: marginalGain(option, coverage) }))
      .filter(({ gain }) => gain.score > EPSILON || gain.population > EPSILON)
      .sort((a, b) => a.option.cost - b.option.cost)
      .filter(({ option, gain }, index, options) => !options.slice(0, index).some((other) => (
        other.option.cost <= option.cost
        && other.gain.score >= gain.score - EPSILON
        && other.gain.population >= gain.population - EPSILON
      )))
      .sort((a, b) => (
        b.gain.score / b.option.cost - a.gain.score / a.option.cost
        || b.gain.score - a.gain.score
        || b.gain.population - a.gain.population
      ));

    for (const { option } of branchOptions) {
      const change = applyOption(option, coverage);
      selection.push(option);
      search(
        depth + 1,
        spent + option.cost,
        score + change.score,
        population + change.population,
      );
      selection.pop();
      rollbackOption(change, coverage);
    }

    search(depth + 1, spent, score, population);
  };

  reportProgress(true);
  search(0, 0, 0, 0);
  reportProgress(true);

  return {
    solution: incumbent.solution.map(({ id, x, y, radius, cost }) => ({
      id,
      x,
      y,
      radius,
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
      affectedCellCount: compactGridIndices.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}
