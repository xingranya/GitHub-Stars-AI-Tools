type BrandIconProps = {
  className?: string;
  markClassName?: string;
  title?: string;
};

export function BrandIcon({ className = '', markClassName = '', title }: BrandIconProps) {
  return (
    <span
      className={`app-brand-icon inline-flex shrink-0 items-center justify-center border border-card-border bg-surface-container-lowest ${className}`}
      title={title}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      <span
        className={`block h-[84%] w-[84%] bg-primary ${markClassName}`}
        style={{
          WebkitMask: 'url("/brand-mark.svg") center / contain no-repeat',
          mask: 'url("/brand-mark.svg") center / contain no-repeat',
        }}
      />
    </span>
  );
}
