import type { SVGProps } from "react";

/**
 * Small inline icon set (1.5px strokes on a 20px grid). Inline SVG keeps the
 * bundle free of an icon library and lets icons inherit currentColor.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 11.5 10 4l7 7.5" />
    <path d="M5 10v6h10v-6" />
    <path d="M8.5 16v-3.5h3V16" />
  </Base>
);
export const IconLeads = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="7" r="3" />
    <path d="M2.5 16c.8-2.7 3-4 5.5-4s4.7 1.3 5.5 4" />
    <path d="M13.5 4.5a2.6 2.6 0 0 1 0 5M15.5 12.3c1 .6 1.7 1.8 2 3.2" />
  </Base>
);
export const IconPipeline = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="3.5" width="4" height="13" rx="1" />
    <rect x="8" y="3.5" width="4" height="9" rx="1" />
    <rect x="13.5" y="3.5" width="4" height="6" rx="1" />
  </Base>
);
export const IconTasks = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="14" height="14" rx="2.5" />
    <path d="m6.5 10 2.3 2.3 4.7-4.8" />
  </Base>
);
export const IconBolt = (p: IconProps) => (
  <Base {...p}>
    <path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" />
  </Base>
);
export const IconSettings = (p: IconProps) => (
  <Base {...p}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
  </Base>
);
export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </Base>
);
export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 4v12M4 10h12" />
  </Base>
);
export const IconSun = (p: IconProps) => (
  <Base {...p}>
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 2.5v1.5M10 16v1.5M17.5 10H16M4 10H2.5M15.3 4.7l-1 1M5.7 14.3l-1 1M15.3 15.3l-1-1M5.7 5.7l-1-1" />
  </Base>
);
export const IconMoon = (p: IconProps) => (
  <Base {...p}>
    <path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z" />
  </Base>
);
export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Base>
);
export const IconMenu = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h14M3 10h14M3 14h14" />
  </Base>
);
export const IconChevronRight = (p: IconProps) => (
  <Base {...p}>
    <path d="m8 5 5 5-5 5" />
  </Base>
);
export const IconChevronLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="m12 5-5 5 5 5" />
  </Base>
);
export const IconCalendar = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
    <path d="M3 8.5h14M7 2.5v3M13 2.5v3" />
  </Base>
);
export const IconPhone = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 3.5h3l1.5 3.5-2 1.3a9 9 0 0 0 5.2 5.2l1.3-2 3.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A13.5 13.5 0 0 1 2.5 5.1 1.5 1.5 0 0 1 4 3.5Z" />
  </Base>
);
export const IconMail = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="m3 5.5 7 5.5 7-5.5" />
  </Base>
);
export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l.8 11h8.4l.8-11" />
  </Base>
);
export const IconEdit = (p: IconProps) => (
  <Base {...p}>
    <path d="M12.5 3.5 16.5 7.5 7 17H3v-4l9.5-9.5Z" />
  </Base>
);
export const IconAlert = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 3 2.5 16.5h15L10 3Z" />
    <path d="M10 8v4M10 14.2v.1" />
  </Base>
);
export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Base>
);
export const IconLogout = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 3.5H4.5v13H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" />
  </Base>
);
export const IconGrip = (p: IconProps) => (
  <Base {...p}>
    <path d="M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01" strokeWidth={2.4} />
  </Base>
);
export const IconArrowUpRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 14 14 6M7 6h7v7" />
  </Base>
);
