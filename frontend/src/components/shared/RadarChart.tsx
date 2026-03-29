interface RadarChartProps {
  dimensions: { label: string; value: number; max?: number }[];
  size?: number;
  color?: string;
  bgColor?: string;
}

export default function RadarChart({
  dimensions,
  size = 240,
  color = '#0049d4',
  bgColor = '#e7e6ff',
}: RadarChartProps) {
  const n = dimensions.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 30; // leave room for labels

  const getPoint = (i: number, scale: number) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      x: cx + radius * scale * Math.cos(angle),
      y: cy + radius * scale * Math.sin(angle),
    };
  };

  const polygon = (scale: number) =>
    Array.from({ length: n }, (_, i) => {
      const p = getPoint(i, scale);
      return `${p.x},${p.y}`;
    }).join(' ');

  const dataPolygon = dimensions
    .map((dim, i) => {
      const max = dim.max ?? 100;
      const scale = Math.min(dim.value / max, 1);
      const p = getPoint(i, scale);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  const labelPoints = dimensions.map((dim, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const labelRadius = radius + 18;
    return {
      x: cx + labelRadius * Math.cos(angle),
      y: cy + labelRadius * Math.sin(angle),
      label: dim.label,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {/* Background grid levels */}
      {[0.33, 0.66, 1].map((level) => (
        <polygon
          key={level}
          points={polygon(level)}
          fill={level === 1 ? bgColor : 'none'}
          stroke="#e0e0ff"
          strokeWidth={1}
          fillOpacity={level === 1 ? 0.3 : 0}
        />
      ))}

      {/* Axis lines */}
      {Array.from({ length: n }, (_, i) => {
        const p = getPoint(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="#e0e0ff"
            strokeWidth={1}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={dataPolygon}
        fill={color}
        fillOpacity={0.2}
        stroke={color}
        strokeWidth={2}
      />

      {/* Data points */}
      {dimensions.map((dim, i) => {
        const max = dim.max ?? 100;
        const scale = Math.min(dim.value / max, 1);
        const p = getPoint(i, scale);
        return (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
        );
      })}

      {/* Labels */}
      {labelPoints.map((lp, i) => (
        <text
          key={i}
          x={lp.x}
          y={lp.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-on-surface-variant text-[10px] font-bold"
        >
          {lp.label}
        </text>
      ))}
    </svg>
  );
}
