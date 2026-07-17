import { ChevronDown, ChevronUp, GripHorizontal, MapPinned, MoveDiagonal2, X } from "lucide-react";
import { useState } from "react";
import { useFloatingPanel } from "../hooks/useFloatingPanel";

export function ShelterRoster({ placed, candidates, cells, selected, visible, onSelect, onHide }) {
  const [isOpen, setIsOpen] = useState(false);
  const { panelRef, style, hasCustomFrame, dragHandleProps, resizeHandleProps } = useFloatingPanel({
    active: visible,
    minWidth: 220,
    minHeight: 140,
  });
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

  if (!visible) return null;

  return (
    <section ref={panelRef} style={style} className={`shelter-roster ${isOpen ? "is-open" : ""} ${hasCustomFrame ? "is-custom-frame" : ""}`} data-export-ignore="true">
      <header className="shelter-roster-header">
        <button className="floating-drag-handle" type="button" title="Drag built shelters window" aria-label="Drag built shelters window" {...dragHandleProps}>
          <GripHorizontal size={15} />
        </button>
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
        <button className="floating-window-close" type="button" title="Hide built shelters window" aria-label="Hide built shelters window" onClick={onHide}>
          <X size={14} />
        </button>
      </header>

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

      {isOpen && (
        <span className="floating-resize-handle" title="Resize built shelters window" aria-label="Resize built shelters window" {...resizeHandleProps}>
          <MoveDiagonal2 size={13} />
        </span>
      )}
    </section>
  );
}
