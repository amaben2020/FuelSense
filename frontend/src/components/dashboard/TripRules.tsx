'use client';

import { HelpCircle } from 'lucide-react';
import { TRIP_BREAK_MINUTES } from '@/lib/trip-rules';

/**
 * What the words on the trip screens actually mean.
 *
 * Every figure here is derived, not read off a sensor, and a manager seeing
 * "Ended at Ado · parked 2h 17m" has no way to know whether the vehicle was
 * switched off for those hours or merely stationary — or why a two-minute halt
 * is a "pause" while a six-minute one is a "stop". Stating the thresholds is
 * cheaper than the trust lost the first time somebody assumes the wrong one.
 *
 * A `<details>` rather than a tooltip: it prints, it survives a screenshot,
 * and it needs no hover — which a manager on a phone does not have.
 *
 * Deliberately says nothing about what separates a stop from a pause: the map
 * already carries that key beside the coloured dots it explains, and a second
 * copy here is one more thing to keep in step with the thresholds.
 */
export function TripRules({ className = '' }: { className?: string }) {
  return (
    <details className={`group rounded-lg border border-edge bg-panel-deep ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-mid hover:text-ink">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        What counts as a trip?
      </summary>
      <div className="space-y-2.5 border-t border-edge px-3 py-2.5 text-xs leading-relaxed text-ink-dim">
        <p>
          <span className="font-semibold text-ink">A trip</span> starts when the vehicle begins
          moving and ends once it has sat with the{' '}
          <span className="text-ink-mid">ignition off for {TRIP_BREAK_MINUTES} minutes</span> —
          or once the tracker has been silent that long. Switching off for a shorter errand
          keeps it the same trip, which is why a school run and the drive on from it can appear
          as one journey. Anything under 300 m is treated as manoeuvring, not a trip.
        </p>
        <p>
          <span className="font-semibold text-ink">Parked</span> on an
          &ldquo;Ended at&rdquo; row is how long the vehicle stayed there before its next trip —
          a duration, never a distance. Durations are written{' '}
          <span className="font-mono text-ink-mid">2h 17m</span> or{' '}
          <span className="font-mono text-ink-mid">45 min</span>; distances always carry{' '}
          <span className="font-mono text-ink-mid">km</span>.
        </p>
        <p>
          Fuel on these screens is <span className="text-ink-mid">modelled</span>, not measured:
          distance at the vehicle&apos;s rate, plus idle burn. These trackers carry no fuel-level
          sensor.
        </p>
      </div>
    </details>
  );
}
