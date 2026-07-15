import { CalendarDays, Dices, RotateCcw, Shuffle, ThermometerSun } from "lucide-react";

const avatarSrc = `${import.meta.env.BASE_URL}avatar.jpg`;

export function TopBar({
  scenario,
  onScenarioChange,
  time,
  onTimeChange,
  budget,
  placedCount,
  populationScore,
  candidateCount,
  onClear,
  onNewChallenge,
  onAiSolution,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <a
          className="brand-mark"
          href="https://craftsfool.com"
          aria-label="Visit Craftsfool home"
          title="Visit Craftsfool home"
        >
          <img src={avatarSrc} alt="" />
        </a>
        <div className="brand-copy">
          <h1>Heat Relief Planner</h1>
          <p>{candidateCount}-site strategy challenge</p>
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
          <span>People reached</span>
          <strong>{populationScore.toLocaleString()} · {placedCount} stations</strong>
        </div>
        <button className="icon-button topbar-icon-button" type="button" title="Clear current plan" aria-label="Clear current plan" onClick={onClear}>
          <RotateCcw size={16} />
        </button>
        <button className="icon-text-button ai-solution-button" type="button" title="Generate a random budget-maximal solution" onClick={onAiSolution}>
          <Dices size={16} />
          AI random
        </button>
        <button className="icon-text-button" type="button" title="Generate 12 new fixed candidate sites" onClick={onNewChallenge}>
          <Shuffle size={16} />
          New game
        </button>
      </div>
    </header>
  );
}
