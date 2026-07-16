import { useMemo, useState } from "react";
import { Inspector } from "./components/Inspector";
import { LayerPanel } from "./components/LayerPanel";
import { MapCanvas } from "./components/MapCanvas";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import {
  LAYER_DEFINITIONS,
  STATION_RADII,
  buildCity,
  generateRandomSolution,
  getCellMetrics,
  getPopulationReached,
  getStationCoverage,
  rankChallengeSites,
  scoreCell,
  selectChallengeSites,
} from "./model/cityModel";
import { generateOptimalSolution } from "./model/optimalSolution";

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
  const [candidateCount, setCandidateCount] = useState(DEFAULT_CANDIDATE_COUNT);
  const [challengeIds, setChallengeIds] = useState(() =>
    selectChallengeSites(buildCity("afternoon", "baseline"), DEFAULT_CANDIDATE_COUNT)
      .map((cell) => cell.id),
  );

  const cells = useMemo(() => buildCity(time, scenario), [time, scenario]);
  const candidates = useMemo(
    () => rankChallengeSites(cells, challengeIds, weights, enabled),
    [cells, challengeIds, weights, enabled],
  );
  const challengeIdSet = useMemo(() => new Set(challengeIds), [challengeIds]);
  const selected = cells.find((cell) => cell.id === selectedId) ?? candidates[0] ?? null;
  const candidateRank = candidates.findIndex((candidate) => candidate.id === selected?.id) + 1;
  const isCandidate = candidateRank > 0;
  const selectedBaseScore = selected ? scoreCell(selected, weights, enabled) : 0;
  const selectedScore = selected ? scoreCell(selected, weights, enabled, placed) : 0;
  const serviceReduction = selectedBaseScore - selectedScore;
  const stationCoverage = selected ? getStationCoverage(selected, placed) : 0;
  const selectedStation = placed.find((station) => station.id === selected?.id);
  const effectiveRadius = selectedStation?.radius ?? radius;
  const calculatedMetrics = useMemo(
    () => getCellMetrics(selected, effectiveRadius, cells),
    [selected, effectiveRadius, cells],
  );
  const metrics = selectedStation
    ? { ...calculatedMetrics, cost: selectedStation.cost }
    : calculatedMetrics;
  const spent = placed.reduce((sum, station) => sum + station.cost, 0);
  const budget = STARTING_BUDGET - spent;
  const isPlaced = placed.some((station) => station.id === selected?.id);
  const populationScore = useMemo(
    () => getPopulationReached(cells, placed),
    [cells, placed],
  );
  const placedIds = useMemo(() => new Set(placed.map((station) => station.id)), [placed]);
  const cheapestRemainingCost = candidates.reduce((minimum, candidate) => {
    if (placedIds.has(candidate.id)) return minimum;
    return Math.min(minimum, getCellMetrics(candidate, STATION_RADII[0], cells).cost);
  }, Number.POSITIVE_INFINITY);
  const budgetLocked = budget < cheapestRemainingCost;
  const populationImpact = useMemo(() => {
    if (!selected || !isCandidate) return 0;
    if (selectedStation) {
      const withoutSelected = placed.filter((station) => station.id !== selectedStation.id);
      return populationScore - getPopulationReached(cells, withoutSelected);
    }
    const proposedStation = {
      id: selected.id,
      x: selected.x,
      y: selected.y,
      radius: effectiveRadius,
      cost: metrics.cost,
    };
    return getPopulationReached(cells, [...placed, proposedStation]) - populationScore;
  }, [cells, effectiveRadius, isCandidate, metrics.cost, placed, populationScore, selected, selectedStation]);
  const maxAffordableRadius = selected
    ? STATION_RADII.filter((option) => {
        const optionCost = getCellMetrics(selected, option, cells).cost;
        const available = selectedStation ? budget + selectedStation.cost : budget;
        return optionCost <= available;
      }).at(-1) ?? STATION_RADII[0]
    : STATION_RADII[0];

  const clearPlan = () => {
    setSelectedId(candidates[0]?.id ?? null);
    setHovered(null);
    setRadius(150);
    setPlaced([]);
  };

  const startChallenge = (count) => {
    const nextCandidates = selectChallengeSites(cells, count);
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
    const solution = generateRandomSolution(candidates, cells, STARTING_BUDGET);
    setPlaced(solution);
    setSelectedId(solution[0]?.id ?? candidates[0]?.id ?? null);
    setRadius(solution[0]?.radius ?? 150);
  };

  const applyOptimalSolution = async () => {
    const solution = await generateOptimalSolution(candidates, cells, STARTING_BUDGET);
    setPlaced(solution);
    setSelectedId(solution[0]?.id ?? candidates[0]?.id ?? null);
    setRadius(solution[0]?.radius ?? 150);
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
    const nextMetrics = getCellMetrics(selected, value, cells);
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
        populationScore={populationScore}
        candidateCount={candidates.length}
        onClear={clearPlan}
        onNewChallenge={newChallenge}
        onAiSolution={applyRandomSolution}
        onOptimalSolution={applyOptimalSolution}
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
          populationImpact={populationImpact}
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
        candidateCount={candidates.length}
        budgetLocked={budgetLocked}
      />
    </div>
  );
}
