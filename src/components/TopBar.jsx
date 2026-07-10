import { CalendarDays, Grid3X3, RotateCcw, ThermometerSun } from "lucide-react";

export function TopBar({ scenario, onScenarioChange, time, onTimeChange, budget, placedCount, onReset }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Grid3X3 size={21} strokeWidth={2.2} />
        </span>
        <div>
          <h1>Heat Relief Planner</h1>
          <p>Pixel-grid site selection</p>
        </div>
      </div>

      <div className="scenario-controls">
        <label className="select-control">
          <CalendarDays size={16} />
          <span>Scenario</span>
          <select value={scenario} onChange={(event) => onScenarioChange(event.target.value)}>
            <option value="baseline">Baseline 2026</option>
            <option value="high-growth">High footfall</option>
            <option value="heatwave">Heatwave day</option>
          </select>
        </label>
        <label className="select-control">
          <ThermometerSun size={16} />
          <span>Time</span>
          <select value={time} onChange={(event) => onTimeChange(event.target.value)}>
            <option value="morning">Morning (7-10am)</option>
            <option value="afternoon">Afternoon (2-5pm)</option>
            <option value="evening">Evening (5-8pm)</option>
          </select>
        </label>
      </div>

      <div className="topbar-summary">
        <div>
          <span>Budget remaining</span>
          <strong>${budget.toLocaleString()}</strong>
        </div>
        <div>
          <span>Stations placed</span>
          <strong>{placedCount}</strong>
        </div>
        <button className="icon-text-button" type="button" onClick={onReset}>
          <RotateCcw size={16} />
          Reset
        </button>
      </div>
    </header>
  );
}
