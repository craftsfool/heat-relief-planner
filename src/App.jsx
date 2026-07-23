import { useEffect, useMemo, useRef, useState } from "react";
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
  getPopulationReached,
  getPriorityReduction,
  getStationCoverage,
  rankChallengeSites,
  scoreCell,
  selectChallengeSites,
} from "./model/cityModel";
import { generateGreedyDemonstration, generateGreedyLocalSolution } from "./model/greedyLocalSolution";
import { generateExactOptimalSolution } from "./model/exactOptimalSolution";

const STARTING_BUDGET = 2_500_000;
const DEFAULT_CANDIDATE_COUNT = 12;
const INITIAL_GREEDY_DEMO = {
  open: false,
  status: "idle",
  phase: "idle",
  steps: [],
  stepIndex: -1,
  speed: 1,
  error: null,
};

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
  const [greedyDemo, setGreedyDemo] = useState(INITIAL_GREEDY_DEMO);
  const greedyDemoRunRef = useRef(0);
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
  const populationScore = useMemo(
    () => getPopulationReached(planningCells, placed),
    [placed, planningCells],
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

  const closeGreedyDemo = () => {
    greedyDemoRunRef.current += 1;
    setGreedyDemo((current) => ({
      ...INITIAL_GREEDY_DEMO,
      speed: current.speed,
    }));
  };

  const advanceGreedyDemo = () => {
    if (!greedyDemo.steps.length) return;

    if (greedyDemo.phase === "intro") return;

    if (greedyDemo.phase === "focus") {
      setPlaced(greedyDemo.steps.slice(0, greedyDemo.stepIndex + 1).map((step) => step.station));
      setGreedyDemo((current) => ({ ...current, phase: "applied" }));
      return;
    }

    if (greedyDemo.phase === "applied") {
      setGreedyDemo((current) => ({ ...current, phase: "overview" }));
      return;
    }

    const nextIndex = greedyDemo.stepIndex + 1;
    if (nextIndex >= greedyDemo.steps.length) {
      setGreedyDemo((current) => ({ ...current, status: "complete", phase: "overview" }));
      return;
    }

    const nextStep = greedyDemo.steps[nextIndex];
    setSelectedId(nextStep.station.id);
    setRadius(nextStep.station.radius);
    setGreedyDemo((current) => ({
      ...current,
      stepIndex: nextIndex,
      phase: "focus",
    }));
  };

  useEffect(() => {
    if (greedyDemo.status !== "playing" || !greedyDemo.steps.length) return undefined;
    if (greedyDemo.phase === "intro") return undefined;
    const phaseDelay = {
      idle: 650,
      focus: 1450,
      applied: 1500,
      overview: 850,
    };
    const delay = (phaseDelay[greedyDemo.phase] ?? 900) / greedyDemo.speed;
    const timer = window.setTimeout(advanceGreedyDemo, delay);
    return () => window.clearTimeout(timer);
  }, [greedyDemo.phase, greedyDemo.speed, greedyDemo.status, greedyDemo.stepIndex, greedyDemo.steps]);

  const startGreedyDemo = async () => {
    const runId = greedyDemoRunRef.current + 1;
    greedyDemoRunRef.current = runId;
    setMode("composite");
    setPlaced([]);
    setHovered(null);
    setGreedyDemo((current) => ({
      ...INITIAL_GREEDY_DEMO,
      open: true,
      status: visibleCandidates.length ? "solving" : "error",
      speed: current.speed,
      error: visibleCandidates.length ? null : "No candidate sites are available in this map.",
    }));
    if (!visibleCandidates.length) return;

    try {
      const result = await generateGreedyDemonstration(
        visibleCandidates,
        planningCells,
        STARTING_BUDGET,
        weights,
        enabled,
      );
      if (greedyDemoRunRef.current !== runId) return;
      const candidateDetails = new Map(candidates.map((candidate, index) => [candidate.id, {
        rank: index + 1,
        zone: candidate.zone,
      }]));
      const steps = result.steps.map((step) => ({
        ...step,
        rank: candidateDetails.get(step.station.id)?.rank ?? "?",
        zone: candidateDetails.get(step.station.id)?.zone ?? "Unknown zone",
      }));
      setSelectedId(visibleCandidates[0]?.id ?? null);
      setRadius(150);
      setGreedyDemo((current) => ({
        ...current,
        status: steps.length ? "playing" : "complete",
        steps,
        stepIndex: -1,
        phase: steps.length ? "intro" : "overview",
        error: null,
      }));
    } catch (error) {
      if (greedyDemoRunRef.current !== runId) return;
      setGreedyDemo((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Greedy search failed.",
      }));
    }
  };

  const toggleGreedyDemo = () => {
    if (greedyDemo.status === "complete") {
      setPlaced([]);
      setSelectedId(visibleCandidates[0]?.id ?? null);
      setRadius(150);
      setGreedyDemo((current) => ({ ...current, status: "playing", stepIndex: -1, phase: "intro" }));
      return;
    }
    setGreedyDemo((current) => ({
      ...current,
      status: current.status === "playing" ? "paused" : "playing",
    }));
  };

  const restartGreedyDemo = () => {
    setPlaced([]);
    setSelectedId(visibleCandidates[0]?.id ?? null);
    setRadius(150);
    setGreedyDemo((current) => ({ ...current, status: "playing", stepIndex: -1, phase: "intro" }));
  };

  const completeGreedyIntro = () => {
    setGreedyDemo((current) => current.phase === "intro"
      ? { ...current, phase: "idle" }
      : current);
  };

  const clearPlan = () => {
    closeGreedyDemo();
    setSelectedId(visibleCandidates[0]?.id ?? null);
    setHovered(null);
    setRadius(150);
    setPlaced([]);
  };

  const startChallenge = (count) => {
    closeGreedyDemo();
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
    closeGreedyDemo();
    const solution = generateRandomSolution(visibleCandidates, planningCells, STARTING_BUDGET);
    setPlaced(solution);
    setSelectedId(solution[0]?.id ?? visibleCandidates[0]?.id ?? null);
    setRadius(solution[0]?.radius ?? 150);
  };

  const applyImprovedSolution = async () => {
    closeGreedyDemo();
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
    closeGreedyDemo();
    const buildableCells = planningCells.filter((cell) => cell.buildable);
    const traversal = await generateGreedyLocalSolution(
      buildableCells,
      planningCells,
      STARTING_BUDGET,
      weights,
      enabled,
      { fullTraversal: true },
    );
    const refinementIdSet = new Set(traversal.refinementIds);
    const refinementPool = buildableCells.filter((cell) => refinementIdSet.has(cell.id));
    const { solution, stats } = await generateExactOptimalSolution(
      refinementPool,
      planningCells,
      STARTING_BUDGET,
      weights,
      enabled,
    );
    if (!stats.optimal) throw new Error("The refinement solver finished without an optimality proof.");
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
    closeGreedyDemo();
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
    closeGreedyDemo();
    setPlaced((current) => current.filter((station) => station.id !== selectedStation.id));
  };

  const changeRadius = (value) => {
    closeGreedyDemo();
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
        onScenarioChange={(value) => {
          closeGreedyDemo();
          setScenario(value);
        }}
        time={time}
        onTimeChange={(value) => {
          closeGreedyDemo();
          setTime(value);
        }}
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
          onToggle={(id) => {
            closeGreedyDemo();
            setEnabled((current) => ({ ...current, [id]: !current[id] }));
          }}
          onCandidateCount={changeCandidateCount}
          onWeight={(id, value) => {
            closeGreedyDemo();
            setWeights((current) => ({ ...current, [id]: value }));
          }}
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
          greedyDemo={greedyDemo}
          onSubzone={(code) => {
            closeGreedyDemo();
            setActiveSubzoneCode(code);
            const firstVisibleCandidate = code
              ? candidates.find((candidate) => candidate.subzoneCode === code)
              : candidates[0];
            setSelectedId(firstVisibleCandidate?.id ?? null);
            setHovered(null);
          }}
          onMode={setMode}
          onSelect={(cell) => {
            if (!challengeIdSet.has(cell.id)) return;
            closeGreedyDemo();
            setSelectedId(cell.id);
          }}
          onHover={setHovered}
          onStartGreedyDemo={startGreedyDemo}
          onToggleGreedyDemo={toggleGreedyDemo}
          onStepGreedyDemo={advanceGreedyDemo}
          onRestartGreedyDemo={restartGreedyDemo}
          onCompleteGreedyIntro={completeGreedyIntro}
          onCloseGreedyDemo={closeGreedyDemo}
          onGreedyDemoSpeed={(speed) => setGreedyDemo((current) => ({ ...current, speed }))}
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
        populationScore={populationScore}
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
