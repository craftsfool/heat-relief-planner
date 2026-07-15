import { CircleDollarSign, Crosshair, Grid3X3, Trophy } from "lucide-react";
import { CELL_SIZE_METRES, GRID_COLS, GRID_ROWS } from "../model/cityModel";

export function StatusBar({ selected, score, budget, placedCount, populationScore, candidateRank, candidateCount, budgetLocked }) {
  return (
    <footer className="statusbar">
      <div><Grid3X3 size={18} /><span>Grid</span><strong>{GRID_COLS} x {GRID_ROWS} · {CELL_SIZE_METRES} m cells</strong></div>
      <div><Crosshair size={18} /><span>Candidate</span><strong>{selected ? `#${candidateRank} of ${candidateCount} · priority ${score}` : "None"}</strong></div>
      <div><Trophy size={18} /><span>Game score</span><strong>{populationScore.toLocaleString()} people reached</strong></div>
      <div><CircleDollarSign size={18} /><span>Remaining</span><strong>${budget.toLocaleString()} · {budgetLocked ? "budget locked" : `${placedCount} placed`}</strong></div>
    </footer>
  );
}
