import { ChevronDown, ChevronUp, MapPinned } from "lucide-react";
import { useState } from "react";

export function ShelterRoster({ placed, candidates, cells, selected, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const rankById = new Map(candidates.map((candidate, index) => [candidate.id, index + 1]));
  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  const totalCost = placed.reduce((sum, station) => sum + station.cost, 0);
  const shelters = placed
    .map((station) => ({
      ...station,
      cell: cellById.get(station.id),
      rank: rankById.get(station.id),
    }))
    .filter((station) => station.cell)
    .sort((a, b) => a.rank - b.rank);

  return (
    <section className={`shelter-roster ${isOpen ? "is-open" : ""}`} data-export-ignore="true">
      <button
        className="shelter-roster-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls="built-shelter-list"
        onClick={() => setIsOpen((open) => !open)}
      >
        <MapPinned size={16} />
        <span>Built shelters</span>
        <strong>{shelters.length}</strong>
        {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {isOpen && (
        <div className="shelter-roster-body" id="built-shelter-list">
          <div className="shelter-roster-summary">
            <span>Total construction cost</span>
            <strong>${totalCost.toLocaleString()}</strong>
          </div>

          {shelters.length ? (
            <div className="shelter-roster-list">
              {shelters.map((station) => (
                <button
                  className={selected?.id === station.id ? "is-selected" : ""}
                  type="button"
                  key={station.id}
                  aria-label={`Select built shelter priority ${station.rank}`}
                  onClick={() => onSelect(station.cell)}
                >
                  <span className="shelter-rank">#{station.rank}</span>
                  <span className="shelter-details">
                    <strong>Cell {station.cell.x + 1}, {station.cell.y + 1}</strong>
                    <small>{station.radius} m radius</small>
                  </span>
                  <span className="shelter-cost">${station.cost.toLocaleString()}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="shelter-roster-empty">No shelters built</p>
          )}
        </div>
      )}
    </section>
  );
}
