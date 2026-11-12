interface RingGaugeProps {
  size: number;
  /** Percentuais (0–100), do anel externo para o interno. */
  rings: number[];
  color: string;
  track: string;
  strokeWidth: number;
  gap?: number;
  /** Cor do círculo central (só desenhado com mais de um anel). */
  center?: string;
}

export function RingGauge({
  size,
  rings,
  color,
  track,
  strokeWidth,
  gap = strokeWidth / 2,
  center = "#262626",
}: RingGaugeProps) {
  const c = size / 2;
  const radii = rings.map((_, i) => c - strokeWidth / 2 - i * (strokeWidth + gap));
  const innerR = radii[radii.length - 1] - strokeWidth / 2 - gap;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rings.map((pct, i) => {
        const r = radii[i];
        const len = 2 * Math.PI * r;
        return (
          <g key={i}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={strokeWidth} />
            {pct > 0 && (
              <circle
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * len} ${len}`}
                transform={`rotate(-90 ${c} ${c})`}
              />
            )}
          </g>
        );
      })}
      {rings.length > 1 && innerR > 0 && <circle cx={c} cy={c} r={innerR} fill={center} />}
    </svg>
  );
}
