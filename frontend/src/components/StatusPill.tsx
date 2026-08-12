import type { ReactElement } from 'react';

import { CheckIcon, ClockIcon, CrossIcon, PulseIcon, WarnIcon } from './icons';

export type StatusTone = 'queued' | 'running' | 'pass' | 'fail' | 'warn';

const TONE_ICON: Record<StatusTone, (props: { className?: string }) => ReactElement> = {
  queued: ClockIcon,
  running: PulseIcon,
  pass: CheckIcon,
  fail: CrossIcon,
  warn: WarnIcon,
};

/** Status is always icon + label together — color alone never carries the meaning (colorblind-safe, per PRODUCT.md accessibility principle). */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const ToneIcon = TONE_ICON[tone];
  return (
    <span className={`status-pill status-pill-${tone}`}>
      <ToneIcon className="status-pill-icon" />
      {label}
    </span>
  );
}

export function toneForJobStatus(status: string): StatusTone {
  if (status === 'completed') return 'pass';
  if (status === 'failed') return 'fail';
  if (status === 'running') return 'running';
  return 'queued';
}

export function toneForVerdict(verdict: string): StatusTone {
  if (verdict === 'pass' || verdict === 'non_breaking' || verdict === 'healthy') return 'pass';
  if (verdict === 'fail' || verdict === 'breaking' || verdict === 'error') return 'fail';
  return 'warn';
}
