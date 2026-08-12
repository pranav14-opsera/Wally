import { useEffect, useState } from 'react';

interface WallyLogoProps {
  size?: number;
  animate?: boolean;
}

/** Geometric W mark. On first mount it draws itself in one continuous stroke; every mount after that (or with reduced motion) renders fully drawn — the animation is a one-time introduction, not a loop. */
export function WallyLogo({ size = 32, animate = true }: WallyLogoProps) {
  const [drawn, setDrawn] = useState(!animate);

  useEffect(() => {
    if (!animate) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDrawn(true);
      return;
    }
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className="wally-logo" aria-hidden="true">
      <path
        d="M6 10 L13 32 L20 14 L27 32 L34 10"
        stroke="var(--accent)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        style={{
          strokeDasharray: 100,
          strokeDashoffset: drawn ? 0 : 100,
          transition: animate ? 'stroke-dashoffset 700ms cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
        }}
      />
    </svg>
  );
}
