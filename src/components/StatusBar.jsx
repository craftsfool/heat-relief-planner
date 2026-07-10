import { CircleDollarSign, Crosshair, Grid3X3, Layers3 } from "lucide-react";
import { CELL_SIZE_METRES, GRID_COLS, GRID_ROWS } from "../model/cityModel";

export function StatusBar({ selected, score, budget, placedCount }) {
  return (
    <footer className="statusbar">
      <div><Grid3X3 size={18} /><span>Grid</span><strong>{GRID_COLS} x {GRID_ROWS} · {CELL_SIZE_METRES} m cells</strong></div>
      <div><Crosshair size={18} /><span>Selected</span><strong>{selected ? `${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}` : "None"}</strong></div>
      <div><Layers3 size={18} /><span>Live score</span><strong>{selected ? `${score} / 100` : "—"}</strong></div>
      <div><CircleDollarSign size={18} /><span>Remaining</span><strong>${budget.toLocaleString()} · {placedCount} placed</strong></div>
    </footer>
  );
}
