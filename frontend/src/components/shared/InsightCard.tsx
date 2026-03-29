import Icon from './Icon';

interface InsightCardProps {
  title?: string;
  children: React.ReactNode;
  variant?: 'insight' | 'info';
}

export default function InsightCard({ title = "Architect's Insight", children, variant = 'insight' }: InsightCardProps) {
  const borderColor = variant === 'insight' ? 'border-tertiary-fixed-dim' : 'border-secondary-container';
  const bgColor = variant === 'insight' ? 'bg-tertiary-fixed/10' : 'bg-surface-container-low';
  const iconColor = variant === 'insight' ? 'text-on-tertiary-container' : 'text-secondary-container';
  const icon = variant === 'insight' ? 'lightbulb' : 'info';

  return (
    <div className={`p-4 ${bgColor} border-l-4 ${borderColor} rounded-r-xl`}>
      <div className="flex gap-3">
        <Icon name={icon} className={iconColor} />
        <div>
          <p className={`text-sm font-bold ${iconColor} mb-1`}>{title}</p>
          <div className="text-sm text-on-surface-variant leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
