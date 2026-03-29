interface IconProps {
  name: string;
  filled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' };

export default function Icon({ name, filled, size = 'md', className = '' }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined ${sizeMap[size]} ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}
