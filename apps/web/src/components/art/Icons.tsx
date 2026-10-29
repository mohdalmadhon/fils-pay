/** Line icons for navigation and actions: 24px grid, 1.8 stroke, round
 *  caps, coloured by `currentColor`. Decorative: the text next to each icon
 *  carries the meaning. */
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="fp-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      {children}
    </svg>
  );
}

export const icons = {
  transactions: (
    <Icon>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </Icon>
  ),
  links: (
    <Icon>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Icon>
  ),
  webhooks: (
    <Icon>
      <path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
      <path d="M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0" opacity="0.5" />
      <circle cx="12" cy="6" r="2" />
    </Icon>
  ),
  settlement: (
    <Icon>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
      <path d="M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
    </Icon>
  ),
  reconciliation: (
    <Icon>
      <path d="M12 4v16M6 20h12M5 8h14" />
      <path d="M5 8l-2.5 6a3 3 0 0 0 5 0Z M19 8l-2.5 6a3 3 0 0 0 5 0Z" />
    </Icon>
  ),
  overview: (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  ),
  merchants: (
    <Icon>
      <path d="M4 10l1.5-5h13L20 10M4 10v9h16v-9M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M10 19v-4h4v4" />
    </Icon>
  ),
  credits: (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  ),
  imports: (
    <Icon>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Icon>
  ),
  replay: (
    <Icon>
      <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6" />
    </Icon>
  ),
  menu: (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </Icon>
  ),
  close: (
    <Icon>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  ),
  logout: (
    <Icon>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
    </Icon>
  ),
  copy: (
    <Icon>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
  ),
  check: (
    <Icon>
      <path d="M5 12l5 5 9-10" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  ),
};
