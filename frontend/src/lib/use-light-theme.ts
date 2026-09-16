'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the page is in light mode right now. The theme is a `.light` class
 * on <html> that ThemeToggle flips, so anything that has to restyle itself
 * outside CSS — a Google map, a canvas — watches the class rather than
 * re-deriving the user's choice from storage.
 */
export function useLightTheme(): boolean {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setLight(root.classList.contains('light'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return light;
}
