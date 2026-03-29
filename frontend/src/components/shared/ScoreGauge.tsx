interface ScoreGaugeProps {
  score: number; // 0-100
  size?: 'sm' | 'lg';
  label?: string;
}

export default function ScoreGauge({ score, size = 'sm', label }: ScoreGaugeProps) {
  const isLg = size === 'lg';
  const r = isLg ? 88 : 20;
  const cx = isLg ? 96 : 24;
  const sw = isLg ? 8 : 4;
  const psw = isLg ? 12 : 4;
  const dim = isLg ? 192 : 48;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);

  const strokeClass = isLg
    ? 'text-secondary drop-shadow-[0_0_12px_rgba(30,97,255,0.3)]'
    : 'text-tertiary-fixed-dim';

  return (
    <div className={`relative flex items-center justify-center`} style={{ width: dim, height: dim }}>
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${cx * 2} ${cx * 2}`}>
        <circle
          className="text-surface-container-high"
          cx={cx} cy={cx} r={r}
          fill="transparent" stroke="currentColor" strokeWidth={sw}
        />
        <circle
          className={strokeClass}
          cx={cx} cy={cx} r={r}
          fill="transparent" stroke="currentColor"
          strokeWidth={psw}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-extrabold tracking-tighter text-primary ${isLg ? 'text-5xl' : 'text-xs'}`}>
          {score}%
        </span>
        {label && (
          <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
