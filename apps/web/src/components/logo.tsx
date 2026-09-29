/** Three linked nodes: files connected by imports, the product's core idea. */
export function LogoMark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <rect width="24" height="24" rx="6" className="fill-zinc-900 dark:fill-zinc-100" />
      <path
        d="M7 8.5 L12 15.5 L17 8.5"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="stroke-brand-400 dark:stroke-brand-600"
      />
      <circle cx="7" cy="8.5" r="2.1" className="fill-white dark:fill-zinc-900" />
      <circle cx="17" cy="8.5" r="2.1" className="fill-white dark:fill-zinc-900" />
      <circle cx="12" cy="15.5" r="2.4" className="fill-brand-400 dark:fill-brand-600" />
    </svg>
  );
}
