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
  getDemandState,
  getLayerValue,
  getPopulationReached,
  rankChallengeSites,
  selectChallengeSites,
} from "./model/cityModel";
import { generateGreedyDemonstration, generateGreedyLocalSolution } from "./model/greedyLocalSolution";
import { generateExactOptimalSolution } from "./model/exactOptimalSolution";
import {
  isStandardSolverConfig,
} from "./model/solverTask";
import {
  loadPrecomputedSolution,
  requestQueuedSolution,
} from "./model/solutionSources";

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

export default function App() {
  const [scenario, setScenario] = useState("baseline");
  const [time, setTime] = useState("afternoon");
  const [mode, setMode] = useState("base");
  const [activeLayer, setActiveLayer] = useState("demand");
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
    () => rankChallengeSites(cells, challengeIds),
    [cells, challengeIds],
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
  const selectedStation = placed.find((station) => station.id === selected?.id);
  const effectiveRadius = selectedStation?.radius ?? radius;
  const demandState = useMemo(
    () => getDemandState(planningCells, placed),
    [placed, planningCells],
  );
  const selectedLocalDemand = selected
    ? getLayerValue(selected, "demand", demandState)
    : 0;
  const metricBaseStations = useMemo(
    () => selectedStation
      ? placed.filter((station) => station.id !== selectedStation.id)
      : placed,
    [placed, selectedStation],
  );
  const calculatedMetrics = useMemo(
    () => getCellMetrics(selected, effectiveRadius, planningCells, metricBaseStations),
    [selected, effectiveRadius, metricBaseStations, planningCells],
  );
  const metrics = selectedStation
    ? { ...calculatedMetrics, cost: selectedStation.cost }
    : calculatedMetrics;
  const spent = placed.reduce((sum, station) => sum + station.cost, 0);
  const budget = STARTING_BUDGET - spent;
  const isPlaced = placed.some((station) => station.id === selected?.id);
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
    setMode("base");
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
    const rankedNext = rankChallengeSites(cells, nextIds);
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
    );
    setPlaced(solution);
    setSelectedId(solution[0]?.id ?? visibleCandidates[0]?.id ?? null);
    setRadius(solution[0]?.radius ?? 150);
    return solution;
  };

  const applyGlobalImprovedSolution = async () => {
    closeGreedyDemo();
    const solverConfig = {
      scenario,
      time,
      subzoneCode: activeSubzoneCode,
      budget: STARTING_BUDGET,
    };
    let solution = null;

    try {
      const precomputed = await loadPrecomputedSolution(solverConfig);
      solution = precomputed?.solution ?? null;
      if (solution) console.info("Loaded precomputed global solution", precomputed.key);
    } catch (error) {
      console.warn("Precomputed solution unavailable", error);
    }

    if (!solution && !isStandardSolverConfig(solverConfig)) {
      try {
        const queued = await requestQueuedSolution(solverConfig);
        solution = queued.solution;
        console.info("Loaded Vercel queued solution", queued.key);
      } catch (error) {
        console.warn("Remote solver unavailable; using browser workers", error);
      }
    }

    if (!solution) {
      const buildableCells = planningCells.filter((cell) => cell.buildable);
      const traversal = await generateGreedyLocalSolution(
        buildableCells,
        planningCells,
        STARTING_BUDGET,
        { fullTraversal: true },
      );
      const refinementLimit = activeSubzoneCode ? 10 : 24;
      const refinementIdSet = new Set(traversal.refinementIds.slice(0, refinementLimit));
      const refinementPool = buildableCells.filter((cell) => refinementIdSet.has(cell.id));
      const exact = await generateExactOptimalSolution(
        refinementPool,
        planningCells,
        STARTING_BUDGET,
      );
      if (!exact.stats.optimal) {
        throw new Error("The refinement solver finished without an optimality proof.");
      }
      solution = exact.solution;
    }

    const solutionIds = solution.map((station) => station.id);
    const rankedSolution = rankChallengeSites(cells, solutionIds);
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
        capacity: metrics.capacity,
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
    const withoutSelected = placed.filter((station) => station.id !== selectedStation.id);
    const nextMetrics = getCellMetrics(selected, value, planningCells, withoutSelected);
    if (spent - selectedStation.cost + nextMetrics.cost > STARTING_BUDGET) return;
    setPlaced((current) =>
      current.map((station) =>
        station.id === selectedStation.id
          ? {
              ...station,
              radius: value,
              capacity: nextMetrics.capacity,
              cost: nextMetrics.cost,
            }
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
        peopleReached={populationScore}
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
          activeLayer={activeLayer}
          mode={mode}
          onCandidateCount={changeCandidateCount}
          onSelect={(id) => {
            closeGreedyDemo();
            setActiveLayer(id);
            setMode("single");
          }}
        />
        <MapCanvas
          cells={cells}
          layers={LAYER_DEFINITIONS}
          mode={mode}
          activeLayer={activeLayer}
          candidates={candidates}
          selected={selected}
          hovered={hovered}
          placed={placed}
          demandState={demandState}
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
          localDemand={selectedLocalDemand}
          radius={effectiveRadius}
          metrics={metrics}
          budget={budget}
          candidateRank={candidateRank}
          isCandidate={isCandidate}
          isPlaced={isPlaced}
          maxAffordableRadius={maxAffordableRadius}
          onRadius={changeRadius}
          onPlace={placeStation}
          onRemove={removeStation}
        />
      </div>
      <StatusBar
        selected={selected}
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
