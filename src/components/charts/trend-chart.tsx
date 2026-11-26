"use client";

// Collected per day: this period as the accent line with a soft fill, the
// previous period of the same length as a dashed grey baseline. Hover or use
// the arrow keys to read both values for a day. Values are USD cents.
import { useEffect, useRef, useState } from "react";

const ACCENT = "#14804a";
const COMPARE = "#898781";
const GRID = "#ebe9e4";
const AXIS = "#d6d3cc";
const MUTED = "#898781";

export type TrendPoint = { date: string; value: number; prevDate: string | null; prev: number | null };

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents >= 1_000_000 ? 0 : 2 }).format(
    cents / 100,
  );
const compactUsd = (cents: number) =>
  cents === 0 ? "$0" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
const dayLabel = (iso: string, long = false) =>
  new Intl.DateTimeFormat("en-GB", { ...(long ? { weekday: "short" } : {}), day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

export function TrendChart({ points, height = 240 }: { points: TrendPoint[]; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length === 0) return null;
  const m = { top: 12, right: 12, bottom: 26, left: 52 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const max = Math.max(1, ...points.map((p) => Math.max(p.value, p.prev ?? 0)));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const x = (i: number) => m.left + (points.length === 1 ? w / 2 : (i * w) / (points.length - 1));
  const y = (v: number) => m.top + h - (v / top) * h;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const prevPts = points.map((p, i) => (p.prev == null ? null : `${x(i).toFixed(1)},${y(p.prev).toFixed(1)}`));
  const prevLine = prevPts.reduce((acc, pt, i) => (pt ? acc + `${acc && prevPts[i - 1] ? "L" : "M"}${pt}` : acc), "");

  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(w / 72))));
  const hp = hover == null ? null : points[hover];
  const change = hp && hp.prev ? ((hp.value - hp.prev) / hp.prev) * 100 : null;

  const pick = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const px = clientX - r.left - m.left;
    const i = Math.round((px / w) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Collected per day from ${dayLabel(points[0].date)} to ${dayLabel(points[points.length - 1].date)}, with the previous period for comparison. Use the arrow keys to read each day.`}
        tabIndex={0}
        className="block rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((v) => Math.min(points.length - 1, (v ?? -1) + 1));
          else if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? points.length) - 1));
          else if (e.key === "Escape") setHover(null);
          else return;
          e.preventDefault();
        }}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
            <text x={m.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10.5" fill={MUTED} fontFamily="var(--font-geist-mono), monospace">
              {compactUsd(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (i % labelEvery === 0 && points.length - 1 - i >= labelEvery * 0.7) || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="10.5" fill={MUTED} fontFamily="var(--font-geist-mono), monospace">
              {dayLabel(p.date)}
            </text>
          ) : null,
        )}
        <path d={area} fill="url(#trend-fill)" />
        {prevLine && <path d={prevLine} fill="none" stroke={COMPARE} strokeWidth="1.5" strokeDasharray="4 4" strokeLinejoin="round" />}
        <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hp && hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + h} stroke={AXIS} strokeWidth="1" />
            {hp.prev != null && <circle cx={x(hover)} cy={y(hp.prev)} r="3.5" fill={COMPARE} stroke="#fff" strokeWidth="2" />}
            <circle cx={x(hover)} cy={y(hp.value)} r="4.5" fill={ACCENT} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hp && hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-52 rounded-xl border border-stone-200 bg-white p-3 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(x(hover) - 104, 0), width - 208),
          }}
          role="status"
        >
          <div className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">{dayLabel(hp.date, true)}</div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-stone-500">
              <span className="h-0.5 w-3 rounded-full" style={{ background: ACCENT }} /> This period
            </span>
            <span className="num text-sm font-semibold text-stone-900">{usd(hp.value)}</span>
          </div>
          {hp.prev != null && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-stone-500">
                <span className="w-3 border-t-[1.5px] border-dashed" style={{ borderColor: COMPARE }} /> {hp.prevDate ? dayLabel(hp.prevDate) : "Previous"}
              </span>
              <span className="num font-medium text-stone-700">{usd(hp.prev)}</span>
            </div>
          )}
          {change != null && Number.isFinite(change) && (
            <div className={`num mt-2 border-t border-stone-100 pt-2 font-semibold ${change >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(0)}% vs the same day last period
            </div>
          )}
        </div>
      )}
    </div>
  );
}
