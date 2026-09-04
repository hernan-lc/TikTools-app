import type { VNode } from 'vue';

type AppIconProps = {
  size?: number;
  className?: string;
};

/** Inline version of the app mark so the client never depends on a relative image URL. */
export function AppIcon({ size = 28, className }: AppIconProps): VNode {
  return (
    <svg
      class={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="TikTools"
    >
      <defs>
        <linearGradient id="tiktools-app-icon-gradient" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop stop-color="#fe2c55" />
          <stop offset=".5" stop-color="#a855f7" />
          <stop offset="1" stop-color="#25f4ee" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#tiktools-app-icon-gradient)" />
      <path d="M24 18h16c4.418 0 8 3.582 8 8v11c0 4.418-3.582 8-8 8H30l-10 7 2.5-7.5A8 8 0 0 1 16 37V26c0-4.418 3.582-8 8-8Z" fill="#fff" />
      <circle cx="42" cy="25" r="3.2" fill="#fe2c55" />
      <path d="M25 30.5h15M25 37.5h11" fill="none" stroke="#141824" stroke-width="3" stroke-linecap="round" />
    </svg>
  );
}
