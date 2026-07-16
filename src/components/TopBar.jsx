import { CalendarDays, Check, Dices, LoaderCircle, RotateCcw, Shuffle, Target, ThermometerSun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const avatarSrc = `${import.meta.env.BASE_URL}avatar.jpg`;
const OPTIMAL_HOLD_MS = 700;

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
  onOptimalSolution,
}) {
  const [aiState, setAiState] = useState("idle");
  const holdTimer = useRef(null);
  const feedbackTimer = useRef(null);
  const suppressClick = useRef(false);

  useEffect(() => () => {
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(feedbackTimer.current);
  }, []);

  const cancelHold = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setAiState((current) => current === "holding" ? "idle" : current);
  };

  const runOptimalSolution = async () => {
    setAiState("solving");
    try {
      await onOptimalSolution();
      setAiState("complete");
      feedbackTimer.current = window.setTimeout(() => setAiState("idle"), 1800);
    } catch (error) {
      console.error(error);
      setAiState("error");
      feedbackTimer.current = window.setTimeout(() => setAiState("idle"), 2200);
    }
  };

  const startHold = (event) => {
    if (aiState === "solving") return;
    window.clearTimeout(feedbackTimer.current);
    suppressClick.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setAiState("holding");
    holdTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      runOptimalSolution();
    }, OPTIMAL_HOLD_MS);
  };

  const handleAiClick = (event) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (event.shiftKey && aiState !== "solving") {
      runOptimalSolution();
      return;
    }
    if (aiState !== "solving") {
      window.clearTimeout(feedbackTimer.current);
      setAiState("idle");
      onAiSolution();
    }
  };

  const cancelPointerHold = () => {
    cancelHold();
    suppressClick.current = false;
  };

  const aiLabel = aiState === "holding"
    ? "Hold for optimal"
    : aiState === "solving"
      ? "Solving optimal"
      : aiState === "complete"
        ? "Optimal ready"
        : aiState === "error"
          ? "Solver failed"
          : "AI random";
  const AiIcon = aiState === "holding"
    ? Target
    : aiState === "solving"
      ? LoaderCircle
      : aiState === "complete"
        ? Check
        : Dices;

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
        <button
          className={`icon-text-button ai-solution-button is-${aiState}`}
          type="button"
          title="Click for a random solution. Press and hold, or Shift-click, for the optimal solution."
          aria-label="AI random. Press and hold, or Shift-click, for the optimal solution."
          disabled={aiState === "solving"}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerCancel={cancelPointerHold}
          onContextMenu={(event) => event.preventDefault()}
          onClick={handleAiClick}
        >
          <AiIcon className={aiState === "solving" ? "spin" : ""} size={16} />
          {aiLabel}
        </button>
        <button className="icon-text-button" type="button" title={`Generate ${candidateCount} new fixed candidate sites`} onClick={onNewChallenge}>
          <Shuffle size={16} />
          New game
        </button>
      </div>
    </header>
  );
}
