/** CodeOrbit mark: an ink tile with one orbit and a mint satellite. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#18181b" />
      <ellipse cx="16" cy="16" rx="10.5" ry="5.2" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.4" transform="rotate(-28 16 16)" />
      <circle cx="16" cy="16" r="3.4" fill="#ffffff" />
      <circle cx="24.6" cy="11.2" r="2.3" fill="#a1ffcb" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Logo className="h-7 w-7" />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">CodeOrbit</span>
    </span>
  );
}
