import { useMemo, useState } from "react";
import { Inspector } from "./components/Inspector";
import { LayerPanel } from "./components/LayerPanel";
import { MapCanvas } from "./components/MapCanvas";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import {
  LAYER_DEFINITIONS,
  buildCity,
  getCellMetrics,
  getStationCoverage,
  rankCandidates,
  scoreCell,
} from "./model/cityModel";

const STARTING_BUDGET = 2_500_000;

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
  const [shortlist, setShortlist] = useState([]);

  const cells = useMemo(() => buildCity(time, scenario), [time, scenario]);
  const candidates = useMemo(
    () => rankCandidates(cells, weights, enabled, placed),
    [cells, weights, enabled, placed],
  );
  const selected = cells.find((cell) => cell.id === selectedId) ?? candidates[0] ?? null;
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
  const isShortlisted = shortlist.includes(selected?.id);

  const reset = () => {
    setScenario("baseline");
    setTime("afternoon");
    setWeights(initialWeights);
    setEnabled(initialEnabled);
    setMode("composite");
    setActiveLayer("heat");
    setSelectedId(null);
    setHovered(null);
    setRadius(150);
    setPlaced([]);
    setShortlist([]);
  };

  const placeStation = () => {
    if (!selected?.buildable || isPlaced || budget < metrics.cost) return;
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

  const toggleShortlist = () => {
    if (!selected) return;
    setShortlist((current) =>
      current.includes(selected.id)
        ? current.filter((id) => id !== selected.id)
        : [...current, selected.id],
    );
  };

  const changeRadius = (value) => {
    setRadius(value);
    if (!selectedStation) return;
    setPlaced((current) =>
      current.map((station) =>
        station.id === selectedStation.id
          ? { ...station, radius: value }
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
        onReset={reset}
      />
      <div className="workspace">
        <LayerPanel
          layers={LAYER_DEFINITIONS}
          weights={weights}
          enabled={enabled}
          activeLayer={activeLayer}
          onToggle={(id) => setEnabled((current) => ({ ...current, [id]: !current[id] }))}
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
          onSelect={(cell) => setSelectedId(cell.id)}
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
          isPlaced={isPlaced}
          isShortlisted={isShortlisted}
          onRadius={changeRadius}
          onPlace={placeStation}
          onShortlist={toggleShortlist}
        />
      </div>
      <StatusBar
        selected={selected}
        score={selectedScore}
        budget={budget}
        placedCount={placed.length}
      />
    </div>
  );
}
