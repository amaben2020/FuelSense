'use client';

import { useProductName } from '@/lib/product-name';
import { useAuthStore } from '@/store/authStore';

import { BrandMark } from '@/components/BrandMark';
import { BrandTheme } from '@/components/BrandTheme';

/**
 * The wait before the dashboard has its data.
 *
 * Deliberately restrained. The previous version played a looping cartoon truck
 * driving around a grid, under a stack of three lines of copy — a wordmark, a
 * "COMMAND CENTER" eyebrow, "Loading fleet command center…", and a sentence
 * about satellite fixes. A fleet manager sees this several times a day; it is
 * not a place to advertise, and an animation with personality gets tiring long
 * before the first week is out.
 *
 * It also carried two glows in colours from nowhere in the palette — a blue
 * (rgba(39,110,241)) and the retired mint — which is how a loading screen ends
 * up looking like it belongs to a different product than the one behind it.
 *
 * What is left: the mark, one line of status, and a determinate-looking sweep.
 * No dependency, no Lottie payload, nothing to tire of.
 */
export function FleetCommandLoader({
  label = 'Loading fleet data',
}: {
  label?: string;
}) {
  const productName = useProductName();
  // A white-labelled account's own mark and colour, from the sign-in cache;
  // every other account gets the FuelSense mark on lemon.
  const customer = useAuthStore((s) => s.customer);
  const logo = customer?.white_label ? customer.logo_url : null;
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6"
      role="status"
      aria-live="polite"
    >
      <BrandTheme customer={customer?.white_label ? customer : null} />
      <div className="flex w-full max-w-[280px] flex-col items-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-14 w-14 object-contain" />
        ) : (
          <BrandMark className="h-9 w-9 text-brand" strokeWidth={4} />
        )}

        <p className="mt-4 text-center text-sm font-semibold tracking-tight text-ink">{productName}</p>

        {/* A single hairline sweep. Reads as progress without claiming a
            percentage we do not know. */}
        <div className="mt-6 h-px w-full overflow-hidden bg-edge">
          <div className="fleet-loader-sweep h-full w-1/3 bg-brand" />
        </div>

        <p className="mt-4 text-xs text-ink-dim">{label}</p>
      </div>
    </div>
  );
}
