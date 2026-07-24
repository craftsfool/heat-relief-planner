import { Check, CircleDollarSign, Flame, MapPin, Minus, Plus, Trash2, Users } from "lucide-react";

export function Inspector({
  cell,
  localDemand,
  radius,
  capacity,
  metrics,
  budget,
  candidateRank,
  isCandidate,
  isPlaced,
  maxAffordableCapacity,
  onCapacity,
  onPlace,
  onRemove,
}) {
  if (!cell) {
    return (
      <aside className="inspector empty-inspector">
        <MapPin size={28} />
        <h2>Select a map cell</h2>
        <p>Click a buildable cell to inspect its data and estimated impact.</p>
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label="Selected site details">
      <div className="candidate-heading">
        <div>
          <span>Challenge site</span>
          <h2>{isCandidate ? `Candidate #${candidateRank}` : "Locked location"}</h2>
        </div>
        <span className={`eligibility ${isCandidate ? "is-buildable" : ""}`}>
          {isCandidate ? "Candidate" : "Unavailable"}
        </span>
      </div>

      <dl className="location-list">
        <div><dt>Grid cell</dt><dd>{cell.x + 1}, {cell.y + 1}</dd></div>
        <div><dt>Zone</dt><dd>{cell.zone}</dd></div>
        <div><dt>Coordinates</dt><dd>{cell.lat.toFixed(4)}, {cell.lon.toFixed(4)}</dd></div>
      </dl>

      <section className="site-data-section">
        <h3>Cell data</h3>
        <dl>
          <div><dt><Users size={14} /> Population demand</dt><dd>{Math.round(localDemand).toLocaleString()} people / ha</dd></div>
          <div><dt><CircleDollarSign size={14} /> Regional cost</dt><dd>${cell.housingPricePsm.toLocaleString()} / m²</dd></div>
          <div><dt><Flame size={14} /> Heat exposure</dt><dd>{Math.round(cell.heat * 100)}%</dd></div>
        </dl>
      </section>

      <section className="radius-section">
        <div className="section-label">
          <div>
            <h3>Station capacity</h3>
            <span className="fixed-radius-label">{radius} m fixed service radius</span>
          </div>
          <div className="radius-stepper">
            <button
              type="button"
              title="Decrease station capacity"
              aria-label="Decrease station capacity"
              disabled={capacity <= 500}
              onClick={() => onCapacity(Math.max(500, capacity - 500))}
            >
              <Minus size={14} />
            </button>
            <strong>{capacity.toLocaleString()}</strong>
            <button
              type="button"
              title="Increase station capacity"
              aria-label="Increase station capacity"
              disabled={capacity >= 4500 || (isPlaced && capacity >= maxAffordableCapacity)}
              onClick={() => onCapacity(Math.min(
                isPlaced ? maxAffordableCapacity : 4500,
                capacity + 500,
              ))}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <input
          type="range"
          min="500"
          max="4500"
          step="500"
          value={capacity}
          title="Adjust station capacity"
          aria-label="Adjust station capacity"
          onChange={(event) => onCapacity(Math.min(
            isPlaced ? maxAffordableCapacity : 4500,
            Number(event.target.value),
          ))}
        />
        <div className="range-labels"><span>500</span><span>2,500 people</span><span>4,500</span></div>
      </section>

      <div className="inspector-actions">
        <dl className="action-metrics">
          <div>
            <dt><CircleDollarSign size={15} /> Cost</dt>
            <dd>${metrics.cost.toLocaleString()}</dd>
          </div>
          <div>
            <dt><MapPin size={15} /> Service radius</dt>
            <dd>{radius} m</dd>
          </div>
          <div>
            <dt><Users size={15} /> People served</dt>
            <dd>+{metrics.peopleReached.toLocaleString()}</dd>
          </div>
          <div>
            <dt><Users size={15} /> Cost efficiency</dt>
            <dd>{metrics.cost > 0 ? Math.round(metrics.peopleReached / metrics.cost * 100_000).toLocaleString() : 0} people / $100k</dd>
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
