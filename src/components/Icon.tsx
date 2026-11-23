import type { ComponentChildren } from 'preact';

// The app's own icons: one line, the same weight as the tab bar's, rounded, in the color around them.
// Used instead of emoji everywhere (they don't match the look).

export type IconName = 'calendar' | 'clock' | 'alert' | 'info' | 'check' | 'sparkle' | 'plus';

const PATHS: Record<IconName, ComponentChildren> = {
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="8.5" cy="14.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14.5" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 3 19.5h18z" />
      <path d="M12 10v4.5M12 17.2v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  sparkle: (
    <>
      <path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z" />
      <path d="M18.5 15.5c.3 1.8 1 2.5 2.5 2.7-1.5.3-2.2 1-2.5 2.8-.3-1.8-1-2.5-2.5-2.8 1.5-.2 2.2-.9 2.5-2.7z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export function Icon(props: { name: IconName; size?: number; class?: string; label?: string }) {
  const size = props.size ?? 18;
  return (
    <svg
      class={`icon ${props.class ?? ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    >
      {PATHS[props.name]}
    </svg>
  );
}
