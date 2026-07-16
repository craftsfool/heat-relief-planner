import createHighs from "highs";
import highsWasmUrl from "highs/runtime?url";

const solverPromise = createHighs({
  locateFile: () => highsWasmUrl,
  print: () => {},
  printErr: () => {},
});

self.onmessage = async ({ data }) => {
  const { id, model, stationVariables, timeLimit } = data;
  try {
    const solver = await solverPromise;
    const result = solver.solve(model, {
      mip_rel_gap: 0,
      output_flag: false,
      time_limit: timeLimit,
    });
    const selectedVariables = stationVariables.filter(
      (variable) => result.Columns[variable]?.Primal > 0.5,
    );
    self.postMessage({
      id,
      status: result.Status,
      objectiveValue: result.ObjectiveValue,
      selectedVariables,
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
