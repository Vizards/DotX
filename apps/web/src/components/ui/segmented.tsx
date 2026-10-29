import { useRef, useState, useLayoutEffect } from 'react';
import { Link } from '@tanstack/react-router';
export type AdminPath = '/admin' | '/admin/devices' | '/admin/agents' | '/admin/security';

export interface NavItem {
  to: AdminPath;
  label: string;
  /** Shown on narrow screens instead of label. */
  short?: string;
}

/**
 * The knob is positioned by measurement, so any label width works.
 * It slides on navigation and on resize, never jumps.
 */
export function Segmented({ items, active }: { items: NavItem[]; active: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const place = () => {
      const knob =
        element.querySelector<HTMLElement>('[aria-current="page"]') ??
        element.querySelector<HTMLElement>('a');
      if (!knob) return;
      // Measured in fractional pixels: offsetLeft rounds to whole pixels, and
      // a rounded knob is a pixel off from the label it sits behind.
      const track = element.getBoundingClientRect();
      const box = knob.getBoundingClientRect();
      const next = { x: box.left - track.left, w: box.width };
      setThumb((current) =>
        current && current.x === next.x && current.w === next.w ? current : next,
      );
    };
    place();
    // Labels change weight when they become current, which resizes them without
    // resizing the track. Observe the links too, and re-measure after webfonts land.
    const observer = new ResizeObserver(place);
    observer.observe(element);
    for (const link of element.querySelectorAll('a')) observer.observe(link);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) place();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [active, items]);

  return (
    <div className="segmented" ref={track} role="navigation">
      {thumb && (
        <span
          className="segmented-thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
        />
      )}
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.to === '/admin' }}
          activeProps={{ 'aria-current': 'page' }}
          aria-label={item.label}
        >
          <span className="nav-full">{item.label}</span>
          <span className="nav-short" aria-hidden="true">
            {item.short ?? item.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
