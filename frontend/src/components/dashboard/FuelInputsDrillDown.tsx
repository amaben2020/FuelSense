'use client';

import { useEffect, useState } from 'react';
import { X, Fuel, History } from 'lucide-react';
import {
  api,
  formatNgn,
  BenchmarkPrice,
  FuelPurchase,
  FuelPurchasesResponse,
  FuelPriceResponse,
} from '@/lib/api';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * "How did we get ₦1,307/L" — the arithmetic behind the Fuel burned card's
 * blended average, plus the two kinds of evidence that feed it: what was
 * actually paid at the pump (receipts) and what the manager has declared the
 * benchmark price to be over time (price periods). Neither list alone answers
 * the question — receipts without periods hide unpurchased litres already in
 * the tank; periods without receipts hide what was really paid.
 */
export function FuelInputsDrillDown({
  open,
  onClose,
  periodDays,
  liters,
  burnedCost,
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
    ])
      .then(([purchaseData, priceData]) => {
        setPurchases(purchaseData);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-edge bg-panel p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-ink-dim hover:text-ink"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2">
          <Fuel className="h-4 w-4 text-accent-y" />
          <h3 className="text-lg font-bold text-ink">How the {formatNgn(blendedPricePerLiter)}/L average was derived</h3>
        </div>
        <p className="mt-1 text-xs text-ink-dim">Last {periodDays} days</p>

        <div className="mt-4 rounded-lg border border-edge bg-canvas p-3">
          <p className="text-xs text-ink-dim">The arithmetic</p>
          <code className="mt-1.5 block rounded bg-panel-deep p-3 font-mono text-xs text-ink-mid">
            {formatNgn(burnedCost)} total cost ÷ {liters.toFixed(1)} L burned = {formatNgn(blendedPricePerLiter)}/L
          </code>
          <p className="mt-1.5 text-[11px] text-ink-dim">
            Every litre is valued at whichever benchmark price was in force the day it burned, then
            averaged — not today&apos;s declared price applied to the whole period.
          </p>
        </div>

        {loading && <p className="mt-4 text-sm text-ink-dim">Loading…</p>}
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}

        {!loading && !error && (
          <>
            <div className="mt-5">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-dim">
                <History className="h-3 w-3" />
                Benchmark price periods in force this window
              </p>
              {priceHistory && priceHistory.length > 0 ? (
                <ul className="mt-2">
                  {priceHistory.map((entry, i) => (
                    <li
                      key={`${entry.effective_from}-${i}`}
                      className="flex items-baseline justify-between gap-3 border-t border-edge/50 py-1.5 text-xs"
                    >
                      <span className="font-mono text-ink">{formatNgn(entry.ngn_per_liter)}/L</span>
                      <span className="text-ink-dim">
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
            </div>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-wider text-ink-dim">
                Fuel purchases logged this period ({receipts.length})
              </p>
              {receipts.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {receipts.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-baseline justify-between gap-3 border-t border-edge/50 py-1.5 text-xs"
                    >
                      <span className="text-ink">
                        {r.license_plate} · {r.liters_declared.toFixed(1)} L @{' '}
                        {formatNgn(r.cost_per_liter_ngn)}/L
                      </span>
                      <span className="font-mono text-ink-dim">
                        {formatNgn(r.total_cost_ngn)} · {formatDate(r.timestamp)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-dim">
                  No fuel purchases logged this period — the litres above are still modelled, not
                  receipted.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
