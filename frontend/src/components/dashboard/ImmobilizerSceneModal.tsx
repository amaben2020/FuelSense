'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Lock, LockOpen, Play, X } from 'lucide-react';
import type { ImmobilizerPhase } from '@/lib/api';
import type { ImmobilizerSceneMoment, ImmobilizerSceneState } from './Immobilizer3D';

const Immobilizer3D = dynamic(() => import('./Immobilizer3D').then((m) => m.Immobilizer3D), {
  ssr: false,
});

const fromPhase = (phase: ImmobilizerPhase): ImmobilizerSceneState => {
  switch (phase) {
    case 'engage_queued':
    case 'engage_sent':
      return 'engaging';
    case 'engaged':
    case 'engaged_confirmed':
      return 'engaged';
    case 'release_queued':
    case 'release_sent':
      return 'releasing';
    default:
      return 'released';
  }
};

const STEPS: { title: string; body: string }[] = [
  {
    title: '1 · Manager confirms',
    body: 'A yes/no on the Theft panel. The request carries confirm: true and the plate; the server refuses anything else.',
  },
  {
    title: '2 · Codec 12 frame',
    body: 'The server writes "setdigout 1?" down the TCP connection the tracker itself opened. No SMS, no gateway.',
  },
  {
    title: '3 · DOUT1 goes high',
    body: 'The FMC150 sinks its output pin to ground and replies "DOUTS are set to:10". It then reports the pin in every record as AVL 179.',
  },
  {
    title: '4 · Relay coil energises',
    body: 'Pins 85 (DOUT1) and 86 (+12 V) sit across the coil. The armature pulls away from the normally-closed contact.',
  },
  {
    title: '5 · Vehicle is dead',
    body: 'The starter signal runs through 30 ↔ 87a. With the contact open the key does nothing — no crank, no start — until it is mobilized from here.',
  },
  {
    title: 'Mobilize',
    body: '"setdigout 0?" drops DOUT1, the coil relaxes, 30 ↔ 87a closes and the vehicle starts normally.',
  },
];

function captionFor(
  state: ImmobilizerSceneState,
  moment: ImmobilizerSceneMoment
): { title: string; body: string; tone: string } {
  switch (state) {
    case 'engaging':
      return moment === 'landed'
        ? { title: 'CUTTING THE STARTER CIRCUIT', body: 'DOUT1 high → relay coil energised → 30/87a open → the vehicle rolls to a stop', tone: 'text-accent-y' }
        : { title: 'SENDING setdigout 1?', body: 'Codec 12 frame on its way down the tracker’s own connection', tone: 'text-accent-y' };
    case 'engaged':
      return moment === 'key_turned'
        ? { title: 'KEY TURNED — NOTHING', body: 'Starter line is open: no crank, no start. Only a mobilize from here restores it.', tone: 'text-bad-bright' }
        : { title: 'IMMOBILIZED', body: 'Starter line open · lights out · the vehicle cannot be started', tone: 'text-bad-bright' };
    case 'releasing':
      return moment === 'landed'
        ? { title: 'RESTORING THE STARTER CIRCUIT', body: 'DOUT1 low → coil relaxes → 30/87a closes → the vehicle starts and pulls away', tone: 'text-good' }
        : { title: 'SENDING setdigout 0?', body: 'Codec 12 frame on its way down the tracker’s own connection', tone: 'text-good' };
    default:
      return { title: 'MOBILIZED', body: 'Starter line closed · the vehicle drives normally', tone: 'text-good' };
  }
}

/**
 * The circuit as a scene. Opens on the live state of the selected vehicle;
 * the replay buttons only drive the animation — nothing here sends anything
 * to a tracker.
 */
export function ImmobilizerSceneModal({
  plate,
  model,
  phase,
  onClose,
}: {
  plate: string;
  model: string | null;
  phase: ImmobilizerPhase;
  onClose: () => void;
}) {
  const live = fromPhase(phase);
  // A replay overrides the live state until "Back to live state"; null means
  // the scene follows the vehicle.
  const [replay, setReplay] = useState<ImmobilizerSceneState | null>(null);
  const state = replay ?? live;
  const replaying = replay !== null;

  const [moment, setMoment] = useState<ImmobilizerSceneMoment>('driving');
  const caption = captionFor(state, moment);

  const play = (action: 'engage' | 'release') => {
    setReplay(action === 'engage' ? 'engaging' : 'releasing');
    setTimeout(() => setReplay(action === 'engage' ? 'engaged' : 'released'), 3200);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/75" aria-label="Close" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-edge px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-ink">How the immobilizer works</h3>
            <p className="mt-0.5 text-xs text-ink-dim">
              {plate} · showing {replaying ? 'a replay' : 'the live state'} — this view never sends a
              command
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-dim hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_320px]">
          <div className="relative min-h-[360px] lg:min-h-[520px]">
            <Immobilizer3D state={state} plate={plate} model={model} onMoment={setMoment} />
            <div className="pointer-events-none absolute left-4 top-4 max-w-[70%]">
              <p className={`font-mono text-lg font-bold tracking-wide ${caption.tone}`}>{caption.title}</p>
              <p className="mt-0.5 text-xs text-ink-mid">{caption.body}</p>
            </div>
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => play('engage')}
                className="inline-flex items-center gap-2 rounded-lg border border-bad/40 bg-panel/90 px-3 py-1.5 text-xs font-semibold text-bad backdrop-blur hover:bg-bad/15"
              >
                <Play className="h-3.5 w-3.5" /> Replay immobilize
              </button>
              <button
                type="button"
                onClick={() => play('release')}
                className="inline-flex items-center gap-2 rounded-lg border border-good/40 bg-panel/90 px-3 py-1.5 text-xs font-semibold text-good backdrop-blur hover:bg-good/15"
              >
                <Play className="h-3.5 w-3.5" /> Replay mobilize
              </button>
              {replaying && (
                <button
                  type="button"
                  onClick={() => setReplay(null)}
                  className="rounded-lg border border-edge bg-panel/90 px-3 py-1.5 text-xs text-ink-mid backdrop-blur hover:bg-panel-hover"
                >
                  Back to live state
                </button>
              )}
            </div>
            <div className="absolute right-4 top-4">
              {state === 'engaged' || state === 'engaging' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-bad/15 px-2.5 py-1 text-xs font-semibold text-bad">
                  <Lock className="h-3.5 w-3.5" /> {state === 'engaging' ? 'Immobilizing…' : 'Immobilized'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-1 text-xs font-semibold text-good">
                  <LockOpen className="h-3.5 w-3.5" /> {state === 'releasing' ? 'Mobilizing…' : 'Mobilized'}
                </span>
              )}
            </div>
          </div>

          <aside className="overflow-y-auto border-t border-edge p-5 lg:border-l lg:border-t-0">
            <ol className="space-y-3">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <p className="text-xs font-semibold text-ink">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{step.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-edge pt-3 font-mono text-[11px] text-ink-dim">
              Teltonika FMC130/FMC150 · setdigout · Codec 12 · AVL 179 · relay 85/86/30/87a
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
