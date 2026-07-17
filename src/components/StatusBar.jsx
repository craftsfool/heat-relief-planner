import { CircleDollarSign, Crosshair, Grid3X3, Trophy } from "lucide-react";

export function StatusBar({
  selected,
  score,
  budget,
  placedCount,
  populationScore,
  candidateRank,
  candidateCount,
  budgetLocked,
  gridColumns,
  gridRows,
  gridCellCount,
  cellSizeMetres,
}) {
  return (
    <footer className="statusbar">
      <div><Grid3X3 size={18} /><span>Grid</span><strong>{gridColumns} x {gridRows} · {gridCellCount.toLocaleString()} mapped · {cellSizeMetres} m</strong></div>
      <div><Crosshair size={18} /><span>Candidate</span><strong>{selected ? `#${candidateRank} of ${candidateCount} · priority ${score}` : "None"}</strong></div>
      <div><Trophy size={18} /><span>Game score</span><strong>{populationScore.toLocaleString()} people reached</strong></div>
      <div><CircleDollarSign size={18} /><span>Remaining</span><strong>${budget.toLocaleString()} · {budgetLocked ? "budget locked" : `${placedCount} placed`}</strong></div>
    </footer>
  );
}
