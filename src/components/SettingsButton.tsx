/** The round "personal account" button at the top of every main screen, opening settings. */
export function SettingsButton(props: { onClick: () => void }) {
  return (
    <button class="icon-btn" aria-label="הגדרות" onClick={props.onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
      </svg>
    </button>
  );
}
