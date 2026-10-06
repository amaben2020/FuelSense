'use client';

import { useEffect, useId, useState } from 'react';

type MermaidApi = (typeof import('mermaid'))['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;

/** Read a theme token off the page so diagrams follow light and dark mode. */
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Mermaid is ~1 MB, so it loads the first time a diagram appears, not with the
 * dashboard. `securityLevel: 'strict'` keeps model-written diagrams from
 * carrying scripts or click handlers into the page.
 */
async function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'inherit',
    themeVariables: {
      background: token('--panel', '#17171b'),
      primaryColor: token('--panel-deep', '#121215'),
      primaryBorderColor: token('--brand', '#cde04a'),
      primaryTextColor: token('--ink', '#ededf1'),
      secondaryColor: token('--panel', '#17171b'),
      tertiaryColor: token('--panel', '#17171b'),
      lineColor: token('--ink-dim', '#86868f'),
      textColor: token('--ink', '#ededf1'),
      noteBkgColor: token('--panel-deep', '#121215'),
      noteTextColor: token('--ink', '#ededf1'),
      actorBkg: token('--panel-deep', '#121215'),
      actorBorder: token('--brand', '#cde04a'),
      actorTextColor: token('--ink', '#ededf1'),
      signalColor: token('--ink-dim', '#86868f'),
      signalTextColor: token('--ink', '#ededf1'),
    },
  });
  return mermaid;
}

export function FuelBrainDiagram({ code }: { code: string }) {
  const id = `fb-mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg: out }) => {
        if (live) setSvg(out);
      })
      .catch(() => {
        // Mermaid leaves an error element behind on a failed render.
        document.getElementById(`d${id}`)?.remove();
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [code, id]);

  if (failed) {
    return (
      <div className="my-3 rounded-xl border border-edge bg-panel p-3">
        <p className="mb-2 text-[11px] text-ink-dim">This diagram could not be drawn; here is its source.</p>
        <pre className="overflow-x-auto text-[12px] text-ink-mid">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (!svg) {
    return <div className="my-3 h-24 animate-pulse rounded-xl border border-edge bg-panel" aria-label="Drawing diagram" />;
  }
  return (
    <div
      className="my-3 overflow-x-auto rounded-xl border border-edge bg-panel p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // Rendered by mermaid with securityLevel 'strict', which sanitises labels.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
