'use client';

import { useEffect, useState } from 'react';
import { X, Fuel, Gauge, History, Receipt, Route } from 'lucide-react';
import {
  api,
  formatNgn,
  BenchmarkPrice,
  FuelPurchase,
  FuelPurchasesResponse,
  FuelPriceResponse,
  VehicleCalibrationStatus,
  fetchCalibrationStatus,
} from '@/lib/api';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The two kinds of evidence behind the Fuel burned card: what was actually
 * paid at the pump (receipts) and what the manager has declared the benchmark
 * price to be over time (price periods). Neither list alone answers the
 * question — receipts without periods hide unpurchased litres already in the
 * tank; periods without receipts hide what was really paid.
 *
 * This used to lead with "how the ₦X/L average was derived" and show that
 * arithmetic. Both are hidden as of 2026-09-08: the average divides a
 * full-precision cost by a litre total rounded to 0.1 L twice, so it can land
 * outside the range of prices actually declared. See the note in
 * FleetOperationsOverview for the trace and what restoring it needs.
 */
export function FuelInputsDrillDown({
  open,
  onClose,
  periodDays,
  liters,
  burnedCost,
  // Still plumbed through while the average itself is hidden, so restoring it
  // is a matter of putting the caption back rather than re-threading the prop.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  blendedPricePerLiter,
}: {
  open: boolean;
  onClose: () => void;
  periodDays: number;
  liters: number;
  burnedCost: number;
  blendedPricePerLiter: number;
}) {
  const [purchases, setPurchases] = useState<FuelPurchasesResponse | null>(null);
  const [priceHistory, setPriceHistory] = useState<BenchmarkPrice[] | null>(null);
  const [rates, setRates] = useState<VehicleCalibrationStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api<FuelPurchasesResponse>(
        `/telemetry/fuel-purchases?days=${periodDays}&limit=100&include_summary=true`
      ),
      api<FuelPriceResponse>('/fuel-price'),
      fetchCalibrationStatus().catch(() => null),
    ])
      .then(([purchaseData, priceData, calibration]) => {
        setPurchases(purchaseData);
        setRates(calibration?.vehicles ?? null);
        // `history` is newest-first. Keep every period that started inside the
        // window, plus the one period that was already active when the window
        // opened — that one priced the window's earliest litres even though it
        // was declared before the window started.
        const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
        const history = priceData.history ?? [];
        const firstBeforeWindowIndex = history.findIndex(
          (p) => new Date(p.effective_from).getTime() < cutoff
        );
        setPriceHistory(
          firstBeforeWindowIndex === -1 ? history : history.slice(0, firstBeforeWindowIndex + 1)
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load fuel inputs'))
      .finally(() => setLoading(false));
  }, [open, periodDays]);

  if (!open) return null;

  const receipts: FuelPurchase[] = purchases?.purchases ?? [];
  const receiptLiters = receipts.reduce((sum, r) => sum + Number(r.liters_declared || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-edge px-6 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
              <Fuel className="h-4 w-4 text-accent-y" /> What the fuel figures are built on
            </h3>
            <p className="mt-0.5 text-xs text-ink-dim">
              Last {periodDays} days · these trackers carry no fuel sensor, so every litre is
              modelled from the four inputs below
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-dim hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 divide-x divide-edge border-b border-edge bg-canvas">
          <Stat label="Litres burned" value={`${liters.toFixed(1)} L`} hint="modelled" />
          <Stat label="Valued at" value={formatNgn(burnedCost)} hint="benchmark price per day" />
          <Stat
            label="Receipted"
            value={`${receiptLiters.toFixed(1)} L`}
            hint={`${receipts.length} purchase${receipts.length === 1 ? '' : 's'} logged`}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm text-ink-dim">Loading…</p>}
          {error && <p className="text-sm text-bad">{error}</p>}

          {!loading && !error && (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
              <Section
                n={1}
                icon={Route}
                title="Distance × each vehicle's rate"
                body="Kilometres driven, from the tracker's odometer, times the vehicle's consumption; engine-on idling is added for spec rates and already inside a measured one."
              >
                {rates && rates.length > 0 ? (
                  <table className="mt-3 w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-ink-dim">
                        <th className="pb-1.5 font-medium">Vehicle</th>
                        <th className="pb-1.5 text-right font-medium">Rate</th>
                        <th className="pb-1.5 text-right font-medium">Idle</th>
                        <th className="pb-1.5 pl-4 font-medium">Where the rate comes from</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map((v) => (
                        <tr key={v.vehicle_id} className="border-t border-edge/50">
                          <td className="py-1.5 font-mono text-ink">{v.license_plate}</td>
                          <td className="py-1.5 text-right font-mono text-ink">
                            {v.rate_l_per_100km != null ? `${v.rate_l_per_100km.toFixed(1)} L/100km` : '—'}
                          </td>
                          <td className="py-1.5 text-right font-mono text-ink-mid">
                            {v.idle_burn_l_per_hour != null ? `${v.idle_burn_l_per_hour.toFixed(2)} L/h` : '—'}
                          </td>
                          <td className="py-1.5 pl-4">
                            <RateSource source={v.rate_source} fills={v.fill_ups_until_calibrated} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-2 text-xs text-ink-dim">No vehicles with a rate yet.</p>
                )}
              </Section>

              <div className="space-y-4">
              <Section
                n={2}
                icon={Gauge}
                title="Tank anchors"
                body="A receipt marked “filled to full” sets the tank to capacity; a gauge reading sets it to within an eighth. Between anchors the level is the model's arithmetic, and it drifts by the gap between the rate above and the truth."
              />

              <Section
                n={3}
                icon={History}
                title="Benchmark price in force"
                body="Every litre is valued at the benchmark price of the day it burned — not today's price applied to the whole period."
              >
                {priceHistory && priceHistory.length > 0 ? (
                  <ul className="mt-3 divide-y divide-edge/50 text-xs">
                    {priceHistory.map((entry, i) => (
                      <li key={`${entry.effective_from}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                        <span className="font-mono text-ink">{formatNgn(entry.ngn_per_liter)}/L</span>
                        <span className="text-right text-ink-dim">
                          from {formatDate(entry.effective_from)}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-dim">
                    No benchmark declared — every litre fell back to the latest receipt price or the
                    platform default.
                  </p>
                )}
              </Section>

              <Section
                n={4}
                icon={Receipt}
                title={`Fuel purchases logged (${receipts.length})`}
                body="What drivers paid for. Litres bought credit the tank; they do not by themselves say how much is in it."
              >
                {receipts.length > 0 ? (
                  <ul className="mt-3 max-h-56 divide-y divide-edge/50 overflow-y-auto text-xs">
                    {receipts.map((r) => (
                      <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
                        <span className="text-ink">
                          <span className="font-mono">{r.license_plate}</span> · {r.liters_declared.toFixed(1)} L @{' '}
                          {formatNgn(r.cost_per_liter_ngn)}/L
                        </span>
                        <span className="whitespace-nowrap font-mono text-ink-dim">
                          {formatNgn(r.total_cost_ngn)} · {formatDate(r.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-dim">
                    No fuel purchases logged this period — the litres above are modelled, not
                    receipted.
                  </p>
                )}
              </Section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="px-5 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-dim">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-ink-dim">{hint}</p>
    </div>
  );
}

function Section({
  n,
  icon: Icon,
  title,
  body,
  children,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-edge bg-canvas p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-y/15 font-mono text-[11px] font-bold text-accent-y">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Icon className="h-3.5 w-3.5 text-ink-mid" /> {title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">{body}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

function RateSource({
  source,
  fills,
}: {
  source: VehicleCalibrationStatus['rate_source'];
  fills: number;
}) {
  switch (source) {
    case 'calibrated':
      return <span className="text-good">Measured from full-to-full receipts</span>;
    case 'manual':
      return <span className="text-ink-mid">Entered by you · receipts do not change it</span>;
    case 'catalogue':
      return (
        <span className="text-ink-mid">
          Make/model figure · {fills} more full fill{fills === 1 ? '' : 's'} to measure
        </span>
      );
    default:
      return (
        <span className="text-ink-mid">
          Class preset · {fills} more full fill{fills === 1 ? '' : 's'} to measure
        </span>
      );
  }
}
