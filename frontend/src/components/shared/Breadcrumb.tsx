import { Link } from 'react-router-dom';
import Icon from './Icon';

interface BreadcrumbItem {
  label: string;
  to?: string;
}

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-2 text-xs font-mono text-on-surface-variant mb-6">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <Icon name="chevron_right" size="sm" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-secondary transition-colors">{item.label}</Link>
          ) : (
            <span className="text-primary font-bold">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
