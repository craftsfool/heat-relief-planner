import { useEffect, useState } from "react";
import { Eye, Info, MapPinned, Minus, Plus, X } from "lucide-react";

export function LayerPanel({ layers, candidateCount, activeLayer, mode, onCandidateCount, onSelect }) {
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
          <p>Select one dataset to inspect.</p>
        </div>
        <button
          className={`icon-button ${isGuideOpen ? "is-active" : ""}`}
          type="button"
          title="Layer data guide"
          aria-label="Layer data guide"
          aria-expanded={isGuideOpen}
          aria-controls="layer-data-guide"
          onClick={() => setIsGuideOpen((open) => !open)}
        >
          <Info size={17} />
        </button>
      </div>

      {isGuideOpen && (
        <section className="layer-guide" id="layer-data-guide" aria-label="Layer data method">
          <header>
            <div>
              <span>Model method</span>
              <h3>Layer data guide</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Close layer data guide"
              aria-label="Close layer data guide"
              onClick={() => setIsGuideOpen(false)}
            >
              <X size={15} />
            </button>
          </header>
          <dl>
            <div><dt>Population demand</dt><dd>Remaining people after existing and newly placed shelters serve nearby cells.</dd></div>
            <div><dt>Regional cost</dt><dd>The HDB price proxy scales construction cost at each candidate cell.</dd></div>
            <div><dt>Heat exposure</dt><dd>A separate scenario layer; it is not mixed into the optimisation objective.</dd></div>
          </dl>
          <p>The solver maximises people served within the available budget.</p>
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
          <button
            className={`layer-row layer-select-button ${mode === "single" && activeLayer === layer.id ? "is-active" : ""}`}
            key={layer.id}
            type="button"
            onClick={() => onSelect(layer.id)}
          >
            <div className="layer-title-row">
              <span className="visibility-button" aria-hidden="true"><Eye size={18} /></span>
              <span className="layer-swatch" style={{ backgroundColor: layer.color }} />
              <div>
                <strong>{layer.label}</strong>
                <small>{layer.description}</small>
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="data-quality-note">Official population + HDB price proxy · modelled heat exposure</p>
    </aside>
  );
}
