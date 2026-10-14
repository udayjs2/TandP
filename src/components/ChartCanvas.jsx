import { useEffect, useRef } from "react";
import { drawChart } from "../lib/charts";

// On-screen chart. Draws at 2x for sharpness and scales to the container.
export default function ChartCanvas({ spec, height = 300 }) {
  const ref = useRef(null);
  const key = JSON.stringify([spec.type, spec.title, spec.labels, spec.series, spec.signColors]);
  useEffect(() => {
    if (ref.current) drawChart(ref.current, spec, 720, height, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, height]);
  return <canvas ref={ref} className="w-full rounded-lg border border-stone-200 bg-white" style={{ aspectRatio: `720 / ${height}` }} />;
}
