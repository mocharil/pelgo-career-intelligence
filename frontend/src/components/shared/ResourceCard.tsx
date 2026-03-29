import Icon from './Icon';

interface ResourceCardProps {
  title: string;
  url: string;
  hours: number;
  type: string; // course | project | cert | doc
  description?: string;
}

const typeIcons: Record<string, string> = {
  course: 'play_circle',
  project: 'code',
  cert: 'workspace_premium',
  doc: 'description',
};

const typeLabels: Record<string, string> = {
  course: 'COURSE',
  project: 'PROJECT',
  cert: 'CERTIFICATION',
  doc: 'DOCUMENTATION',
};

export default function ResourceCard({ title, url, hours, type, description }: ResourceCardProps) {
  return (
    <div className="group relative bg-surface-container-lowest p-6 rounded-xl transition-all duration-300 hover:translate-y-[-4px]">
      <div className="absolute inset-0 bg-gradient-to-br from-transparent to-surface-container-low opacity-0 group-hover:opacity-100 rounded-xl transition-opacity" />
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <Icon name={typeIcons[type] || 'description'} size="lg" className="text-secondary" />
          <span className="text-[10px] font-mono font-bold text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
            {typeLabels[type] || type.toUpperCase()}
          </span>
        </div>

        <h3 className="text-lg font-bold text-primary mb-2 leading-snug">{title}</h3>
        {description && <p className="text-on-surface-variant text-sm mb-4 leading-relaxed">{description}</p>}

        <div className="flex items-center justify-between mt-auto pt-4">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Icon name="schedule" size="sm" />
            <span className="text-xs font-semibold">{hours} hours</span>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all"
          >
            START LEARNING <Icon name="arrow_forward" size="sm" />
          </a>
        </div>
      </div>
    </div>
  );
}
