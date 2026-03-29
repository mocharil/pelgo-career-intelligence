import Icon from './Icon';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  icon?: string;
}

export default function StatCard({ label, value, trend, icon }: StatCardProps) {
  return (
    <div className="bg-surface-container-low p-6 rounded-xl flex flex-col">
      <span className="text-on-surface-variant text-xs font-bold uppercase tracking-wider mb-2">{label}</span>
      <span className="text-3xl font-extrabold text-primary">{value}</span>
      {trend && (
        <span className="text-xs text-on-tertiary-container font-semibold mt-2 flex items-center gap-1">
          <Icon name={icon || 'trending_up'} size="sm" />
          {trend}
        </span>
      )}
    </div>
  );
}
