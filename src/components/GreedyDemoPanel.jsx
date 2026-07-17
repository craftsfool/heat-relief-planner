import {
  CircleDollarSign,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  TrendingDown,
  X,
} from "lucide-react";

const STATUS_LABELS = {
  solving: "Preparing",
  playing: "Playing",
  paused: "Paused",
  complete: "Complete",
  error: "Error",
};

export function GreedyDemoPanel({
  demo,
  currentStep,
  onToggle,
  onStep,
  onRestart,
  onClose,
  onSpeed,
}) {
  if (!demo.open) return null;

  const completedSteps = Math.max(0, demo.stepIndex + 1);
  const progress = demo.steps.length ? (completedSteps / demo.steps.length) * 100 : 0;
  const canAdvance = demo.steps.length > 0 && demo.stepIndex < demo.steps.length - 1;
  const isPlaying = demo.status === "playing";

  return (
    <section className={`greedy-demo-panel is-${demo.status}`} aria-label="Greedy algorithm decision demo">
      <header className="greedy-demo-header">
        <div>
          <Gauge size={16} />
          <strong>Greedy decision demo</strong>
        </div>
        <span className="greedy-demo-status">{STATUS_LABELS[demo.status] ?? "Ready"}</span>
        <button type="button" title="Close greedy demo" aria-label="Close greedy demo" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="greedy-demo-progress" aria-label={`${completedSteps} of ${demo.steps.length} decisions`}>
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="greedy-demo-content" aria-live="polite">
        {demo.status === "solving" ? (
          <div className="greedy-demo-waiting">
            <LoaderCircle className="spin" size={18} />
            <div><strong>Comparing affordable options</strong><span>Testing every candidate and coverage radius.</span></div>
          </div>
        ) : demo.status === "error" ? (
          <div className="greedy-demo-waiting is-error">
            <strong>Unable to build the decision trace</strong>
            <span>{demo.error}</span>
          </div>
        ) : currentStep ? (
          <>
            <div className="greedy-demo-decision">
              <span>Decision {completedSteps} of {demo.steps.length}</span>
              <strong>Candidate #{currentStep.rank} · {currentStep.zone}</strong>
              <small>Highest marginal score reduction per dollar</small>
            </div>
            <dl className="greedy-demo-metrics">
              <div><dt><TrendingDown size={14} /> Marginal reduction</dt><dd>+{currentStep.marginalGain.toLocaleString()} pts</dd></div>
              <div><dt><Gauge size={14} /> Efficiency</dt><dd>{currentStep.efficiency.toLocaleString()} pts / $100k</dd></div>
              <div><dt>Coverage radius</dt><dd>{currentStep.station.radius} m</dd></div>
              <div><dt><CircleDollarSign size={14} /> Cost</dt><dd>${currentStep.station.cost.toLocaleString()}</dd></div>
              <div><dt>Options compared</dt><dd>{currentStep.evaluatedOptions.toLocaleString()}</dd></div>
              <div><dt>Budget left</dt><dd>${currentStep.remainingBudget.toLocaleString()}</dd></div>
            </dl>
          </>
        ) : (
          <div className="greedy-demo-waiting">
            <Gauge size={18} />
            <div><strong>Ranking the first decision</strong><span>Benefit is recalculated after every shelter.</span></div>
          </div>
        )}
      </div>

      <footer className="greedy-demo-controls">
        <button
          type="button"
          title={isPlaying ? "Pause animation" : "Play animation"}
          aria-label={isPlaying ? "Pause greedy animation" : "Play greedy animation"}
          disabled={!demo.steps.length || demo.status === "solving"}
          onClick={onToggle}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" title="Show next decision" aria-label="Show next greedy decision" disabled={!canAdvance || isPlaying} onClick={onStep}>
          <SkipForward size={15} />
        </button>
        <button type="button" title="Replay from the first decision" aria-label="Replay greedy animation" disabled={!demo.steps.length} onClick={onRestart}>
          <RotateCcw size={15} />
        </button>
        <label>
          <span>Speed</span>
          <select value={demo.speed} onChange={(event) => onSpeed(Number(event.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
          </select>
        </label>
      </footer>
    </section>
  );
}
