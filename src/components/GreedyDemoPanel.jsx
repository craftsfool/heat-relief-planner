import { LoaderCircle, Pause, Play, RotateCcw, SkipForward, X } from "lucide-react";

const PHASE_LABELS = {
  focus: "Before placement",
  applied: "Demand recalculated",
};

const RECORDING_LABELS = {
  recording: "REC",
  processing: "Rendering",
  ready: "Ready",
  unavailable: "Recording unavailable",
};

export function GreedyDemoPanel({
  demo,
  currentStep,
  recordingStatus,
  onToggle,
  onStep,
  onRestart,
  onClose,
  onSpeed,
}) {
  if (!demo.open) return null;

  const isPlaying = demo.status === "playing";
  const isIntro = demo.phase === "intro";
  const canAdvance = demo.steps.length > 0 && !["solving", "complete", "error"].includes(demo.status);
  const showParameters = currentStep && ["focus", "applied"].includes(demo.phase);

  return (
    <>
      {showParameters && (
        <section className={`greedy-demo-parameters is-${demo.phase}`} aria-label="Greedy decision parameters" aria-live="polite">
          <div className="greedy-parameter-heading">
            <span>Decision {demo.stepIndex + 1}/{demo.steps.length} · {PHASE_LABELS[demo.phase]}</span>
            <strong>Candidate #{currentStep.rank} · {currentStep.zone}</strong>
          </div>
          <p><span>People served</span><strong>+{currentStep.peopleServed.toLocaleString()}</strong></p>
          <p><span>Efficiency</span><strong>{currentStep.efficiency.toLocaleString()} people / $100k</strong></p>
          <p><span>Radius · Capacity</span><strong>{currentStep.station.radius} m · {currentStep.station.capacity.toLocaleString()}</strong></p>
          <p><span>Cost</span><strong>${currentStep.station.cost.toLocaleString()}</strong></p>
          <p><span>Options · Budget left</span><strong>{currentStep.evaluatedOptions.toLocaleString()} · ${currentStep.remainingBudget.toLocaleString()}</strong></p>
        </section>
      )}

      <div className="greedy-demo-dock" aria-label="Greedy demo playback controls">
        <span className={`greedy-recording-state is-${recordingStatus}`}>
          {demo.status === "solving"
            ? <><LoaderCircle className="is-spinning" size={12} /> Preparing</>
            : isIntro && recordingStatus === "recording"
              ? "REC · Tour"
              : RECORDING_LABELS[recordingStatus] ?? "Demo"}
        </span>
        <button
          type="button"
          title={isPlaying ? "Pause animation" : "Play animation"}
          aria-label={isPlaying ? "Pause greedy animation" : "Play greedy animation"}
          disabled={!demo.steps.length || demo.status === "solving" || isIntro}
          onClick={onToggle}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" title="Advance demo phase" aria-label="Advance greedy demo phase" disabled={!canAdvance || isPlaying || isIntro} onClick={onStep}>
          <SkipForward size={14} />
        </button>
        <button type="button" title="Replay from the first decision" aria-label="Replay greedy animation" disabled={!demo.steps.length || isIntro} onClick={onRestart}>
          <RotateCcw size={14} />
        </button>
        <label>
          <span>Speed</span>
          <select value={demo.speed} disabled={isIntro} onChange={(event) => onSpeed(Number(event.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
          </select>
        </label>
        <button type="button" title="Close greedy demo" aria-label="Close greedy demo" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </>
  );
}
