import type { SVGProps } from 'react';

/** Shared stroke weight/size so every nav and status icon reads as one consistent icon family. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />;
}

export function GaugeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 12 15 9" />
      <path d="M4.5 12a7.5 7.5 0 1 1 15 0" />
      <path d="M4.5 12h1.5M18 12h1.5M12 4.5V6" />
    </Icon>
  );
}

export function PlugIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 3v4M15 3v4" />
      <path d="M6.5 7h11l-.7 6a4 4 0 0 1-4 3.5h-1.6a4 4 0 0 1-4-3.5z" />
      <path d="M12 16.5V21" />
    </Icon>
  );
}

export function HistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3.7h3.7" />
      <path d="M12 8.5V12l2.5 1.5" />
    </Icon>
  );
}

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l4-5-4-5" />
      <path d="M20 12H9" />
    </Icon>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props} strokeWidth={2.25}>
      <path d="M5 13l4 4L19 7" />
    </Icon>
  );
}

export function CrossIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props} strokeWidth={2.25}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8v4l2.5 1.5" />
    </Icon>
  );
}

export function PulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </Icon>
  );
}

export function WarnIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 17h.01" />
    </Icon>
  );
}
