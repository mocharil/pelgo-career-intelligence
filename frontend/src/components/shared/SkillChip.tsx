import Icon from './Icon';

interface SkillChipProps {
  skill: string;
  variant: 'matched' | 'gap';
}

export default function SkillChip({ skill, variant }: SkillChipProps) {
  const styles = variant === 'matched'
    ? 'bg-tertiary-fixed/20 text-on-tertiary-container'
    : 'bg-error-container text-on-error-container';
  const icon = variant === 'matched' ? 'check_circle' : 'warning';

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${styles}`}>
      <Icon name={icon} size="sm" />
      {skill}
    </span>
  );
}
