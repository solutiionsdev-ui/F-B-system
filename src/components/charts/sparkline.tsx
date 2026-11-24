// Tiny trend line for a stat tile: the history in a quiet grey, today in the
// accent. Decorative support for the number beside it, so no axes.
const LINE = "#b9b7b0";
const ACCENT = "#eb6834";

export function Sparkline({
  values,
  label,
  width = 104,
  height = 34,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const pad = 4;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (values.length - 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <title>{label}</title>
      <path d={d} fill="none" stroke={LINE} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="3.5" fill={ACCENT} stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
