interface GrowthBarProps {
  label: string;
  value: number; // 0-100
  sublabel?: string;
}

export default function GrowthBar({ label, value, sublabel }: GrowthBarProps) {
  return (
    <div>
      <div className="flex justify-between items-end mb-2">
        <span className="font-bold text-sm text-on-surface">{label}</span>
        <span className="text-xs font-extrabold text-on-tertiary-container bg-tertiary-fixed-dim/20 px-2 py-0.5 rounded">
          {value}%
        </span>
      </div>
      <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full shadow-[0_0_8px_rgba(5,7,40,0.3)] transition-all duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
      {sublabel && <p className="text-[10px] text-on-surface-variant mt-1.5">{sublabel}</p>}
    </div>
  );
}
