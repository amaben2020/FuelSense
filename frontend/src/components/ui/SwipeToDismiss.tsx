'use client';

import { useRef, useState, type ReactNode } from 'react';

const START_PX = 8;
const DISMISS_FRACTION = 0.35;
const FLICK_PX_PER_MS = 0.6;

/**
 * Horizontal swipe, either direction, takes the child away.
 *
 * `touch-action: pan-y` leaves vertical scrolling to the browser, and the drag
 * only claims the gesture once it is clearly sideways, so a list of these
 * still scrolls like a list. A click that ends a drag is swallowed so the
 * swipe never also presses a button inside the card.
 */
export function SwipeToDismiss({
  onDismiss,
  disabled = false,
  className = '',
  children,
}: {
  onDismiss: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(1);
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);

  const reset = () => {
    start.current = null;
    setDragging(false);
    setDx(0);
  };

  return (
    <div
      className={className}
      style={{
        touchAction: 'pan-y',
        transform: leaving ? `translateX(${leaving * 110}%)` : `translateX(${dx}px)`,
        opacity: leaving ? 0 : 1 - Math.min(Math.abs(dx) / (width * 1.2), 0.6),
        transition: dragging ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
      }}
      onPointerDown={(e) => {
        if (disabled || leaving) return;
        setWidth(e.currentTarget.offsetWidth || 1);
        start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const mx = e.clientX - s.x;
        if (!dragging) {
          const my = e.clientY - s.y;
          if (Math.abs(my) > START_PX && Math.abs(my) > Math.abs(mx)) {
            start.current = null;
            return;
          }
          if (Math.abs(mx) < START_PX) return;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        setDx(mx);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        if (!s || !dragging) {
          start.current = null;
          return;
        }
        const mx = e.clientX - s.x;
        const speed = Math.abs(mx) / Math.max(e.timeStamp - s.t, 1);
        if (Math.abs(mx) > width * DISMISS_FRACTION || speed > FLICK_PX_PER_MS) {
          setDragging(false);
          setLeaving(mx > 0 ? 1 : -1);
          setTimeout(onDismiss, 200);
          start.current = null;
        } else {
          reset();
        }
      }}
      onPointerCancel={reset}
      onClickCapture={(e) => {
        if (dx !== 0 || leaving) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}
