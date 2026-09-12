'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

const DEFAULT_PRODUCT_NAME = 'FuelSense';

/**
 * What the product calls itself for the signed-in account.
 *
 * A white-labelled fleet sees its own name everywhere the product would
 * otherwise say "FuelSense" — tab title, loading screen, the copy that says
 * who worked a figure out. Everyone else sees FuelSense. The flag is set on
 * the account, not inferred from the company name, so a fleet that simply
 * filled in its company at sign-up is not silently rebranded.
 */
export function productNameFor(customer: { company_name?: string | null; white_label?: boolean | null } | null | undefined): string {
  return customer?.white_label && customer.company_name ? customer.company_name : DEFAULT_PRODUCT_NAME;
}

export function useProductName(): string {
  const customer = useAuthStore((s) => s.customer);
  return productNameFor(customer);
}

/** Keeps the browser tab named for the account while it is signed in. */
export function useProductTitle(suffix?: string): void {
  const name = useProductName();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = suffix ? `${suffix} · ${name}` : name;
    return () => {
      document.title = previous;
    };
  }, [name, suffix]);
}
