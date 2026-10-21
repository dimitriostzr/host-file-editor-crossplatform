// SPDX-License-Identifier: MIT

/** The app icon's mark, at interface size. Same chevrons as the markers written into the file. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="hostserrer-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5468de" />
          <stop offset="1" stopColor="#212e7c" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#hostserrer-logo)" />
      <g fill="none" stroke="#fff" strokeWidth="88" strokeLinecap="round" strokeLinejoin="round">
        <path d="M270 372 L410 512 L270 652" />
        <path d="M442 372 L582 512 L442 652" strokeOpacity="0.72" />
        <path d="M614 372 L754 512 L614 652" strokeOpacity="0.44" />
      </g>
    </svg>
  )
}
