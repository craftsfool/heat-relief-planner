import { useMemo, useState } from "react";
import { Inspector } from "./components/Inspector";
import { LayerPanel } from "./components/LayerPanel";
import { MapCanvas } from "./components/MapCanvas";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import {
  CELL_SIZE_METRES,
  GRID_COLS,
  GRID_ROWS,
  LAYER_DEFINITIONS,
  MAP_SUBZONES,
  STATION_RADII,
  buildCity,
  generateRandomSolution,
  getCellMetrics,
  getPriorityReduction,
  getStationCoverage,
  rankChallengeSites,
  scoreCell,
  selectChallengeSites,
} from "./model/cityModel";
import { generateGreedyLocalSolution } from "./model/greedyLocalSolution";

const STARTING_BUDGET = 2_500_000;
const DEFAULT_CANDIDATE_COUNT = 12;

const initialWeights = Object.fromEntries(
  LAYER_DEFINITIONS.map((layer) => [layer.id, layer.defaultWeight]),
);
const initialEnabled = Object.fromEntries(
  LAYER_DEFINITIONS.map((layer) => [layer.id, true]),
);

export default function App() {
  const [scenario, setScenario] = useState("baseline");
  const [time, setTime] = useState("afternoon");
  const [weights, setWeights] = useState(initialWeights);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState("composite");
  const [activeLayer, setActiveLayer] = useState("heat");
  const [selectedId, setSelectedId] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [radius, setRadius] = useState(150);
  const [placed, setPlaced] = useState([]);
  const [activeSubzoneCode, setActiveSubzoneCode] = useState(null);
  const [candidateCount, setCandidateCount] = useState(DEFAULT_CANDIDATE_COUNT);
  const [challengeIds, setChallengeIds] = useState(() =>
    selectChallengeSites(buildCity("afternoon", "baseline"), DEFAULT_CANDIDATE_COUNT)
      .map((cell) => cell.id),
  );

  const cells = useMemo(() => buildCity(time, scenario), [time, scenario]);
  const activeSubzone = useMemo(
    () => MAP_SUBZONES.find((subzone) => subzone.code === activeSubzoneCode) ?? null,
    [activeSubzoneCode],
  );
  const planningCells = useMemo(
    () => activeSubzone
      ? cells.filter((cell) => cell.subzoneCode === activeSubzone.code)
      : cells,
    [activeSubzone, cells],
  );
  const candidates = useMemo(
    () => rankChallengeSites(cells, challengeIds, weights, enabled),
    [cells, challengeIds, weights, enabled],
  );
  const visibleCandidates = useMemo(
    () => activeSubzoneCode
      ? candidates.filter((candidate) => candidate.subzoneCode === activeSubzoneCode)
      : candidates,
    [activeSubzoneCode, candidates],
  );
  const cellById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell])), [cells]);
  const challengeIdSet = useMemo(() => new Set(challengeIds), [challengeIds]);
  const selectedCell = cellById.get(selectedId);
  const selected = selectedCell && (!activeSubzone || selectedCell.subzoneCode === activeSubzone.code)
    ? selectedCell
    : visibleCandidates[0] ?? null;
  const candidateRank = visibleCandidates.findIndex((candidate) => candidate.id === selected?.id) + 1;
  const isCandidate = candidateRank > 0;
  const selectedBaseScore = selected ? scoreCell(selected, weights, enabled) : 0;
  const selectedScore = selected ? scoreCell(selected, weights, enabled, placed) : 0;
  const serviceReduction = selectedBaseScore - selectedScore;
  const stationCoverage = selected ? getStationCoverage(selected, placed) : 0;
  const selectedStation = placed.find((station) => station.id === selected?.id);
  const effectiveRadius = selectedStation?.radius ?? radius;
  const calculatedMetrics = useMemo(
    () => getCellMetrics(selected, effectiveRadius, planningCells),
    [selected, effectiveRadius, planningCells],
  );
  const metrics = selectedStation
    ? { ...calculatedMetrics, cost: selectedStation.cost }
    : calculatedMetrics;
  const spent = placed.reduce((sum, station) => sum + station.cost, 0);
  const budget = STARTING_BUDGET - spent;
  const isPlaced = placed.some((station) => station.id === selected?.id);
  const gameScore = useMemo(
    () => getPriorityReduction(planningCells, placed, weights, enabled),
    [enabled, placed, planningCells, weights],
  );
  const placedIds = useMemo(() => new Set(placed.map((station) => station.id)), [placed]);
  const cheapestRemainingCost = visibleCandidates.reduce((minimum, candidate) => {
    if (placedIds.has(candidate.id)) return minimum;
    return Math.min(minimum, getCellMetrics(candidate, STATION_RADII[0], planningCells).cost);
  }, Number.POSITIVE_INFINITY);
  const budgetLocked = visibleCandidates.length > 0 && budget < cheapestRemainingCost;
  const scoreImpact = useMemo(() => {
    if (!selected || !isCandidate) return 0;
    if (selectedStation) {
      const withoutSelected = placed.filter((station) => station.id !== selectedStation.id);
      return gameScore - getPriorityReduction(planningCells, withoutSelected, weights, enabled);
    }
    const proposedStation = {
      id: selected.id,
      x: selected.x,
      y: selected.y,
      radius: effectiveRadius,
      cost: metrics.cost,
    };
    return getPriorityReduction(planningCells, [...placed, proposedStation], weights, enabled) - gameScore;
  }, [effectiveRadius, enabled, gameScore, isCandidate, metrics.cost, placed, planningCells, selected, selectedStation, weights]);
  const maxAffordableRadius = selected
    ? STATION_RADII.filter((option) => {
        const optionCost = getCellMetrics(selected, option, planningCells).cost;
        const available = selectedStation ? budget + selectedStation.cost : budget;
        return optionCost <= available;
      }).at(-1) ?? STATION_RADII[0]
    : STATION_RADII[0];

  const clearPlan = () => {
    setSelectedId(visibleCandidates[0]?.id ?? null);
    setHovered(null);
    setRadius(150);
    setPlaced([]);
  };

  const startChallenge = (count) => {
    const nextCandidates = selectChallengeSites(planningCells, count);
    const nextIds = nextCandidates.map((cell) => cell.id);
    const rankedNext = rankChallengeSites(cells, nextIds, weights, enabled);
    setChallengeIds(nextIds);
    setSelectedId(rankedNext[0]?.id ?? null);
    setHovered(null);
    setRadius(150);
    setPlaced([]);
  };

  const newChallenge = () => startChallenge(candidateCount);

  const changeCandidateCount = (count) => {
    setCandidateCount(count);
    startChallenge(count);
  };

  const applyRandomSolution = () => {
    const solution = generateRandomSolution(visibleCandidates, planningCells, STARTING_BUDGET);
    setPlaced(solution);
    setSelectedId(solution[0]?.id ?? visibleCandidates[0]?.id ?? null);
    setRadius(solution[0]?.radius ?? 150);
  };

  const applyImprovedSolution = async () => {
    const solution = await generateGreedyLocalSolution(
      visibleCandidates,
      planningCells,
      STARTING_BUDGET,
      weights,
      enabled,
    );
    setPlaced(solution);
    setSelectedId(solution[0]?.id ?? visibleCandidates[0]?.id ?? null);
    setRadius(solution[0]?.radius ?? 150);
    return solution;
  };

  const applyGlobalImprovedSolution = async () => {
    const buildableCells = planningCells.filter((cell) => cell.buildable);
    const solution = await generateGreedyLocalSolution(
      buildableCells,
      planningCells,
      STARTING_BUDGET,
      weights,
      enabled,
    );
    const solutionIds = solution.map((station) => station.id);
    const rankedSolution = rankChallengeSites(cells, solutionIds, weights, enabled);
    setChallengeIds(solutionIds);
    setCandidateCount(solution.length);
    setPlaced(solution);
    setSelectedId(rankedSolution[0]?.id ?? null);
    setHovered(null);
    setRadius(rankedSolution[0]
      ? solution.find((station) => station.id === rankedSolution[0].id)?.radius ?? 150
      : 150);
    return solution;
  };

  const placeStation = () => {
    if (!selected?.buildable || !isCandidate || isPlaced || budget < metrics.cost) return;
    setSelectedId(selected.id);
    setPlaced((current) => [
      ...current,
      {
        id: selected.id,
        x: selected.x,
        y: selected.y,
        radius,
        cost: metrics.cost,
      },
    ]);
  };

  const removeStation = () => {
    if (!selectedStation) return;
    setPlaced((current) => current.filter((station) => station.id !== selectedStation.id));
  };

  const changeRadius = (value) => {
    if (!selectedStation) {
      setRadius(value);
      return;
    }
    const nextMetrics = getCellMetrics(selected, value, planningCells);
    if (spent - selectedStation.cost + nextMetrics.cost > STARTING_BUDGET) return;
    setPlaced((current) =>
      current.map((station) =>
        station.id === selectedStation.id
          ? { ...station, radius: value, cost: nextMetrics.cost }
          : station,
      ),
    );
  };

  return (
    <div className="app-shell">
      <TopBar
        scenario={scenario}
        onScenarioChange={setScenario}
        time={time}
        onTimeChange={setTime}
        budget={budget}
        placedCount={placed.length}
        gameScore={gameScore}
        candidateCount={candidates.length}
        onClear={clearPlan}
        onNewChallenge={newChallenge}
        onGlobalSolution={applyGlobalImprovedSolution}
        onAiSolution={applyRandomSolution}
        onImprovedSolution={applyImprovedSolution}
      />
      <div className="workspace">
        <LayerPanel
          layers={LAYER_DEFINITIONS}
          candidateCount={candidateCount}
          weights={weights}
          enabled={enabled}
          activeLayer={activeLayer}
          onToggle={(id) => setEnabled((current) => ({ ...current, [id]: !current[id] }))}
          onCandidateCount={changeCandidateCount}
          onWeight={(id, value) => setWeights((current) => ({ ...current, [id]: value }))}
          onSelect={(id) => {
            setActiveLayer(id);
            if (mode === "base") setMode("single");
          }}
        />
        <MapCanvas
          cells={cells}
          layers={LAYER_DEFINITIONS}
          weights={weights}
          enabled={enabled}
          mode={mode}
          activeLayer={activeLayer}
          candidates={candidates}
          selected={selected}
          hovered={hovered}
          placed={placed}
          activeSubzoneCode={activeSubzoneCode}
          onSubzone={(code) => {
            setActiveSubzoneCode(code);
            const firstVisibleCandidate = code
              ? candidates.find((candidate) => candidate.subzoneCode === code)
              : candidates[0];
            setSelectedId(firstVisibleCandidate?.id ?? null);
            setHovered(null);
          }}
          onMode={setMode}
          onSelect={(cell) => challengeIdSet.has(cell.id) && setSelectedId(cell.id)}
          onHover={setHovered}
        />
        <Inspector
          cell={selected}
          layers={LAYER_DEFINITIONS}
          weights={weights}
          enabled={enabled}
          score={selectedScore}
          serviceReduction={serviceReduction}
          stationCoverage={stationCoverage}
          radius={effectiveRadius}
          metrics={metrics}
          budget={budget}
          candidateRank={candidateRank}
          isCandidate={isCandidate}
          isPlaced={isPlaced}
          scoreImpact={scoreImpact}
          maxAffordableRadius={maxAffordableRadius}
          onRadius={changeRadius}
          onPlace={placeStation}
          onRemove={removeStation}
        />
      </div>
      <StatusBar
        selected={selected}
        score={selectedScore}
        budget={budget}
        placedCount={placed.length}
        gameScore={gameScore}
        candidateRank={candidateRank}
        candidateCount={visibleCandidates.length}
        budgetLocked={budgetLocked}
        gridColumns={activeSubzone ? activeSubzone.bounds.maxX - activeSubzone.bounds.minX + 1 : GRID_COLS}
        gridRows={activeSubzone ? activeSubzone.bounds.maxY - activeSubzone.bounds.minY + 1 : GRID_ROWS}
        gridCellCount={planningCells.length}
        cellSizeMetres={CELL_SIZE_METRES}
      />
    </div>
  );
}
