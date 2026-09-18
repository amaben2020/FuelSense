'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Calendar, Loader2, MapPin, Route } from 'lucide-react';
import { DriverTripsResponse, fetchDriverTrips } from '@/lib/driver-api';
import { formatOdometerMiles } from '@/lib/api';

// Vanilla three.js, loaded client-only — matches Vehicle3D's own dynamic
// import. Rendering it during SSR (or under React Three Fiber) is what broke
// the vehicle showcase before; this stays consistent with that fix.
const TripStartFlourish = dynamic(
  () => import('./TripStartFlourish').then((m) => m.TripStartFlourish),
  { ssr: false }
);

export function DriverTripsScreen() {
  const [data, setData] = useState<DriverTripsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDriverTrips(14)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load trips'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-xl bg-bad-deep/20 p-4 text-sm text-bad">{error}</p>;
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* The plate isn't repeated here — the app header above every tab
          already names the vehicle, and this driver has exactly one. */}
      <div className="rounded-2xl border border-edge bg-panel p-4">
        <p className="text-xs uppercase tracking-wider text-ink-dim">Last 14 days</p>
        <p className="mt-1 text-lg font-semibold text-ink">
          {data.daily_history.reduce((s, d) => s + d.trip_count, 0)} trips
        </p>
        <p className="text-xs text-ink-dim">
          {Math.round(data.daily_history.reduce((s, d) => s + d.distance_km, 0))} km ·{' '}
          {Math.round(data.daily_history.reduce((s, d) => s + d.fuel_used_liters, 0) * 10) / 10} L
          fuel
        </p>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          <Calendar className="h-3.5 w-3.5" /> Daily history
        </h3>
        {data.daily_history.length === 0 ? (
          <p className="text-sm text-ink-dim">No trip data yet.</p>
        ) : (
          /* A timeline rather than a card per day: a phone screen shows a
             fortnight at a glance instead of two days. */
          <ol className="relative ml-2 border-l border-edge">
            {data.daily_history.map((day) => (
              <li key={String(day.activity_date)} className="relative pl-4 pb-3 last:pb-0">
                <span
                  className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-canvas ${
                    Number(day.distance_km) > 0 ? 'bg-brand' : 'bg-ink-dim'
                  }`}
                />
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{formatDay(String(day.activity_date))}</p>
                  <span className="text-[11px] text-ink-dim">
                    {day.trip_count} trip{Number(day.trip_count) === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-ink-mid">
                  {day.distance_km} km
                  <span className="text-ink-dim"> · </span>
                  <span className="text-good">{day.fuel_used_liters} L</span>
                  <span className="text-ink-dim"> · </span>
                  <span className={Number(day.idle_hours) >= 1 ? 'text-warn' : 'text-ink-mid'}>{day.idle_hours} h idle</span>
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          <Route className="h-3.5 w-3.5" /> Recent trip starts
        </h3>
        {data.recent_starts.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-2xl border border-edge bg-panel">
            <TripStartFlourish />
          </div>
        )}
        <div className="space-y-2">
          {data.recent_starts.length === 0 ? (
            <p className="text-sm text-ink-dim">No ignition-on events recorded.</p>
          ) : (
            data.recent_starts.map((trip) => (
              <div
                key={trip.started_at}
                className="flex items-center justify-between rounded-xl border border-edge bg-panel/80 px-4 py-3"
              >
                <div>
                  <p className="text-sm text-ink">
                    {new Date(trip.started_at).toLocaleString('en-NG', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: 'Africa/Lagos',
                    })}
                  </p>
                  {trip.odometer_km != null && (
                    <p className="text-xs text-ink-dim">
                      Odometer {formatOdometerMiles(trip.odometer_km)}
                    </p>
                  )}
                </div>
                {trip.latitude != null && (
                  /* Was a bare 25x16 text link — too small to hit on a phone,
                     and sitting right beside a scrolling list. */
                  <a
                    href={`https://www.google.com/maps?q=${trip.latitude},${trip.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-brand active:bg-panel-hover"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Map
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatDay(isoDate: string) {
  const d = new Date(isoDate.includes('T') ? isoDate : `${isoDate}T12:00:00`);
  return d.toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Lagos',
  });
}
