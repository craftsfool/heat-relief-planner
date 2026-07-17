import { useEffect, useState } from "react";
import { Eye, EyeOff, Info, MapPinned, Minus, Plus, X } from "lucide-react";

export function LayerPanel({ layers, candidateCount, weights, enabled, activeLayer, onToggle, onCandidateCount, onWeight, onSelect }) {
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    if (!isGuideOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsGuideOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isGuideOpen]);

  return (
    <aside className="layer-panel" aria-label="Map layers">
      <div className="panel-heading">
        <div>
          <h2>Layers</h2>
          <p>Adjust each factor's influence.</p>
        </div>
        <button
          className={`icon-button ${isGuideOpen ? "is-active" : ""}`}
          type="button"
          title="Layer score guide"
          aria-label="Layer score guide"
          aria-expanded={isGuideOpen}
          aria-controls="layer-score-guide"
          onClick={() => setIsGuideOpen((open) => !open)}
        >
          <Info size={17} />
        </button>
      </div>

      {isGuideOpen && (
        <section className="layer-guide" id="layer-score-guide" aria-label="Layer scoring method">
          <header>
            <div>
              <span>Model method</span>
              <h3>Layer score guide</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Close layer score guide"
              aria-label="Close layer score guide"
              onClick={() => setIsGuideOpen(false)}
            >
              <X size={15} />
            </button>
          </header>
          <dl>
            <div><dt>Demand</dt><dd>Heat, vulnerability and footfall raise priority.</dd></div>
            <div><dt>Cooling</dt><dd>Nearby cooling facilities reduce priority.</dd></div>
            <div><dt>Coverage</dt><dd>Only the strongest overlapping shelter applies; water is excluded.</dd></div>
          </dl>
          <p>Priority = max(0, demand - cooling - up to 30 shelter points)</p>
        </section>
      )}

      <section className="candidate-count-control" aria-label="Candidate site count">
        <div>
          <label htmlFor="candidate-count"><MapPinned size={15} /> Candidate sites</label>
          <div className="candidate-count-stepper">
            <button
              type="button"
              title="Decrease candidate sites"
              aria-label="Decrease candidate sites"
              disabled={candidateCount <= 1}
              onClick={() => onCandidateCount(candidateCount - 1)}
            >
              <Minus size={12} />
            </button>
            <output htmlFor="candidate-count">{candidateCount}</output>
            <button
              type="button"
              title="Increase candidate sites"
              aria-label="Increase candidate sites"
              disabled={candidateCount >= 20}
              onClick={() => onCandidateCount(candidateCount + 1)}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
        <input
          id="candidate-count"
          type="range"
          min="1"
          max="20"
          step="1"
          value={candidateCount}
          onChange={(event) => onCandidateCount(Number(event.target.value))}
        />
        <div className="range-labels"><span>1</span><span>20</span></div>
      </section>

      <div className="layer-list">
        {layers.map((layer) => (
          <section
            className={`layer-row ${activeLayer === layer.id ? "is-active" : ""}`}
            key={layer.id}
            onClick={() => onSelect(layer.id)}
          >
            <div className="layer-title-row">
              <button
                className="visibility-button"
                type="button"
                title={`${enabled[layer.id] ? "Hide" : "Show"} ${layer.label}`}
                aria-label={`${enabled[layer.id] ? "Hide" : "Show"} ${layer.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(layer.id);
                }}
              >
                {enabled[layer.id] ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
              <span className="layer-swatch" style={{ backgroundColor: layer.color }} />
              <div>
                <strong>{layer.label}</strong>
                {layer.direction < 0 && <small>Reduces score</small>}
              </div>
            </div>
            <div className="weight-control">
              <label htmlFor={`weight-${layer.id}`}>Weight</label>
              <input
                id={`weight-${layer.id}`}
                type="range"
                min="0"
                max="0.6"
                step="0.05"
                value={weights[layer.id]}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onWeight(layer.id, Number(event.target.value))}
                style={{ "--range-color": layer.color }}
              />
              <output>{weights[layer.id].toFixed(2)}</output>
            </div>
          </section>
        ))}
      </div>

      <div className="layer-note">
        <span>Current weight sum</span>
        <strong>{weightTotal.toFixed(2)}</strong>
      </div>
      <p className="data-quality-note">GIS-derived base map · modelled factor scores</p>
    </aside>
  );
}
