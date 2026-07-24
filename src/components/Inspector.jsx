import { Check, CircleDollarSign, Info, MapPin, Minus, Plus, Trash2, TrendingDown, Users } from "lucide-react";

export function Inspector({
  cell,
  layers,
  weights,
  enabled,
  score,
  demand,
  radius,
  metrics,
  budget,
  candidateRank,
  isCandidate,
  isPlaced,
  scoreImpact,
  maxAffordableRadius,
  onRadius,
  onPlace,
  onRemove,
}) {
  if (!cell) {
    return (
      <aside className="inspector empty-inspector">
        <MapPin size={28} />
        <h2>Select a map cell</h2>
        <p>Click a buildable cell to inspect its score and estimated impact.</p>
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label="Selected site details">
      <div className="candidate-heading">
        <div>
          <span>Challenge site</span>
          <h2>{isCandidate ? `Priority #${candidateRank}` : "Locked location"}</h2>
        </div>
        <span className={`eligibility ${isCandidate ? "is-buildable" : ""}`}>
          {isCandidate ? "Candidate" : "Unavailable"}
        </span>
      </div>

      <dl className="location-list">
        <div><dt>Grid cell</dt><dd>{cell.x + 1}, {cell.y + 1}</dd></div>
        <div><dt>Zone</dt><dd>{cell.zone}</dd></div>
        <div><dt>Coordinates</dt><dd>{cell.lat.toFixed(4)}, {cell.lon.toFixed(4)}</dd></div>
        <div><dt>Population demand</dt><dd>{Math.round(demand.remaining).toLocaleString()} / {Math.round(demand.initial).toLocaleString()}</dd></div>
        <div><dt>Housing price proxy</dt><dd>${cell.housingPricePsm.toLocaleString()} / m²</dd></div>
      </dl>

      <section className="score-section">
        <div className="section-label">
          <h3>Score breakdown</h3>
          <button className="icon-button" type="button" title="Weighted layer contribution" aria-label="Weighted layer contribution">
            <Info size={15} />
          </button>
        </div>
        <div className="score-bars">
          {layers.map((layer) => {
            const signedContribution = cell[layer.id] * weights[layer.id] * 100;
            const width = Math.min(100, cell[layer.id] * 100);
            return (
              <div className={`score-bar-row ${!enabled[layer.id] ? "is-disabled" : ""}`} key={layer.id}>
                <div>
                  <span className="mini-swatch" style={{ backgroundColor: layer.color }} />
                  <span>{layer.shortLabel}</span>
                  <output>{signedContribution > 0 ? "+" : ""}{signedContribution.toFixed(1)}</output>
                </div>
                <div className="bar-track">
                  <i style={{ width: `${width}%`, backgroundColor: layer.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="total-score">
        <span>Site priority</span>
        <strong>{score}<small>/100</small></strong>
      </div>

      <section className="radius-section">
        <div className="section-label">
          <h3>Service radius</h3>
          <div className="radius-stepper">
            <button
              type="button"
              title="Decrease service radius"
              aria-label="Decrease service radius"
              disabled={radius <= 100}
              onClick={() => onRadius(Math.max(100, radius - 50))}
            >
              <Minus size={14} />
            </button>
            <strong>{radius} m</strong>
            <button
              type="button"
              title="Increase service radius"
              aria-label="Increase service radius"
              disabled={radius >= 300 || (isPlaced && radius >= maxAffordableRadius)}
              onClick={() => onRadius(Math.min(isPlaced ? maxAffordableRadius : 300, radius + 50))}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <input
          type="range"
          min="100"
          max={isPlaced ? maxAffordableRadius : 300}
          step="50"
          value={radius}
          title="Adjust service radius"
          onChange={(event) => onRadius(Number(event.target.value))}
        />
        <div className="range-labels"><span>100 m</span><span>200 m</span><span>300 m</span></div>
      </section>

      <div className="inspector-actions">
        <dl className="action-metrics">
          <div>
            <dt><CircleDollarSign size={15} /> Cost</dt>
            <dd>${metrics.cost.toLocaleString()}</dd>
          </div>
          <div>
            <dt><Users size={15} /> Capacity</dt>
            <dd>{metrics.capacity.toLocaleString()} people</dd>
          </div>
          <div>
            <dt><Users size={15} /> People served</dt>
            <dd>+{metrics.peopleReached.toLocaleString()}</dd>
          </div>
          <div>
            <dt><TrendingDown size={15} /> Priority reduced</dt>
            <dd>+{scoreImpact.toLocaleString()} pts</dd>
          </div>
        </dl>
        <button
          className="primary-button"
          type="button"
          disabled={!isCandidate || isPlaced || budget < metrics.cost}
          onClick={onPlace}
        >
          {isPlaced ? <Check size={18} /> : <MapPin size={18} />}
          {!isCandidate ? "Not a challenge site" : isPlaced ? "Station placed" : budget < metrics.cost ? "Over budget" : "Place station here"}
        </button>
        {isPlaced && (
          <button className="secondary-button remove-station-button" type="button" onClick={onRemove}>
            <Trash2 size={17} />
            Remove station
          </button>
        )}
      </div>
    </aside>
  );
}
