import { CalendarDays, Dices, Earth, RotateCcw, Shuffle, Target, ThermometerSun } from "lucide-react";
import { HoldActionButton } from "./HoldActionButton";

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
  onGlobalSolution,
  onAiSolution,
  onOptimalSolution,
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
        <HoldActionButton
          className="ai-solution-button"
          idleIcon={Dices}
          holdIcon={Target}
          idleLabel="AI random"
          holdLabel="Hold for optimal"
          workingLabel="Solving optimal"
          completeLabel="Optimal ready"
          errorLabel="Solver failed"
          title="Click for a random solution. Press and hold, or Shift-click, for the optimal solution."
          ariaLabel="AI random. Press and hold, or Shift-click, for the optimal solution."
          onClick={onAiSolution}
          onHold={onOptimalSolution}
        />
        <HoldActionButton
          className="new-game-button"
          idleIcon={Shuffle}
          holdIcon={Earth}
          idleLabel="New game"
          holdLabel="Hold for global"
          workingLabel="Global search"
          completeLabel="Global ready"
          errorLabel="Search failed"
          title={`Click for ${candidateCount} new fixed sites. Press and hold, or Shift-click, for the global optimal solution.`}
          ariaLabel="New game. Press and hold, or Shift-click, for the global optimal solution."
          onClick={onNewChallenge}
          onHold={onGlobalSolution}
        />
      </div>
    </header>
  );
}
