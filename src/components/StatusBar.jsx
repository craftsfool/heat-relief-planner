import { CircleDollarSign, Crosshair, Grid3X3, Users } from "lucide-react";

export function StatusBar({
  selected,
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
      <div><Crosshair size={18} /><span>Candidate</span><strong>{selected ? `#${candidateRank} of ${candidateCount} · ${selected.zone}` : "None"}</strong></div>
      <div><Users size={18} /><span>People reached</span><strong>{populationScore.toLocaleString()} people reached</strong></div>
      <div><CircleDollarSign size={18} /><span>Remaining</span><strong>${budget.toLocaleString()} · {budgetLocked ? "budget locked" : `${placedCount} placed`}</strong></div>
    </footer>
  );
}
