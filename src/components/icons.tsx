// A small set of 20px stroke icons, drawn to match each other.
import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  today: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="2.5" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3" />
      <circle cx="10" cy="12.5" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  import: (
    <>
      <path d="M10 3.5v8.5M6.5 8.5 10 12l3.5-3.5" />
      <path d="M4 12.5v2A2 2 0 0 0 6 16.5h8a2 2 0 0 0 2-2v-2" />
    </>
  ),
  rate: (
    <>
      <path d="M4 7h10.5M11.5 4l3 3-3 3" />
      <path d="M16 13H5.5M8.5 10l-3 3 3 3" />
    </>
  ),
  reports: (
    <>
      <path d="M4 16V4M4 16h12" />
      <path d="M7 12.5l3-3.5 2.5 2 3.5-4.5" />
    </>
  ),
  audit: (
    <>
      <path d="M10 3.5 15.5 5.5v4.2c0 3.3-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.5-5.5-6.8V5.5Z" />
      <path d="M7.75 10 9.4 11.6l3-3.2" />
    </>
  ),
  team: (
    <>
      <circle cx="8" cy="7.5" r="2.75" />
      <path d="M3.5 16c.6-2.4 2.3-3.75 4.5-3.75s3.9 1.35 4.5 3.75" />
      <path d="M13 5.1a2.5 2.5 0 0 1 0 4.8M14.4 12.4c1.1.5 1.9 1.6 2.1 3.1" />
    </>
  ),
  clients: (
    <>
      <rect x="3.5" y="6.5" width="13" height="10" rx="2" />
      <path d="M7.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 12.5 5v1.5M3.5 11h13" />
    </>
  ),
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  check: <path d="M5 10.5 8.3 13.5 15 6.5" />,
  info: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 9v4.25M10 6.6v.1" />
    </>
  ),
  alert: (
    <>
      <path d="M10 3.75 17 16H3Z" />
      <path d="M10 8.5v3.5M10 14v.1" />
    </>
  ),
  arrow: <path d="M8 5.5 12.5 10 8 14.5" />,
  cash: (
    <>
      <rect x="2.75" y="5.5" width="14.5" height="9" rx="2" />
      <circle cx="10" cy="10" r="2" />
      <path d="M5.5 8v4M14.5 8v4" />
    </>
  ),
  door: (
    <>
      <path d="M5.5 16.5v-12A1.5 1.5 0 0 1 7 3h6.5A1.5 1.5 0 0 1 15 4.5v12" />
      <path d="M3.5 16.5h13M11.5 10v.1" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="14" height="10.5" rx="2" />
      <path d="m3.75 6 6.25 5 6.25-5" />
    </>
  ),
  file: (
    <>
      <path d="M11.5 3H6.5A1.5 1.5 0 0 0 5 4.5v11A1.5 1.5 0 0 0 6.5 17h7a1.5 1.5 0 0 0 1.5-1.5V6.5Z" />
      <path d="M11.5 3v3.5H15" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
