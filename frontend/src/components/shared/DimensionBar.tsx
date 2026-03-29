interface DimensionBarProps {
  label: string;
  value: number; // 0-100
  description?: string;
}

export default function DimensionBar({ label, value, description }: DimensionBarProps) {
  return (
    <div>
      <div className="flex justify-between items-end mb-2">
        <span className="font-bold text-sm text-on-surface">{label}</span>
        <span className="text-xs font-extrabold text-secondary bg-secondary-fixed px-2 py-0.5 rounded">{value}%</span>
      </div>
      <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-secondary rounded-full transition-all duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
      {description && <p className="text-[10px] text-on-surface-variant mt-1.5">{description}</p>}
    </div>
  );
}
