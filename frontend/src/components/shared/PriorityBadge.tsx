interface PriorityBadgeProps {
  level: 'high' | 'medium' | 'low';
}

const styles = {
  high: 'bg-error-container text-on-error-container',
  medium: 'bg-secondary-fixed text-on-secondary-fixed',
  low: 'bg-surface-container-high text-on-surface-variant',
};

export default function PriorityBadge({ level }: PriorityBadgeProps) {
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${styles[level]}`}>
      Priority: {level}
    </span>
  );
}
