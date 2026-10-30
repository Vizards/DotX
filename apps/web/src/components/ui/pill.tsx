import type { ReactNode } from 'react';
export type Tone = 'live' | 'attn' | 'idle' | 'gone';

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="pill" data-tone={tone}>
      <i className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}
