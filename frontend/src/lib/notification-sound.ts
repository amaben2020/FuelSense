/**
 * A short two-note chime for "a new alert just arrived" — synthesised with
 * the Web Audio API rather than shipped as an audio file, so there is no
 * asset to fetch, cache, or go missing. Silently does nothing if the
 * browser has no AudioContext or autoplay is blocked; a missed chime is
 * never worth surfacing as an error over.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

function tone(audio: AudioContext, freq: number, startAt: number, durationS: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Quick attack, exponential decay — a soft ping rather than a harsh beep,
  // and a short fade-out so it never clicks at the cutoff.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + durationS + 0.02);
}

export function playNotificationChime(): void {
  try {
    const audio = getContext();
    if (!audio) return;
    // A suspended context (autoplay policy, before any user gesture on the
    // page) just won't play — resume() is fire-and-forget, never blocking.
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    tone(audio, 880, now, 0.16);
    tone(audio, 1318.5, now + 0.09, 0.22);
  } catch {
    // Never let a chime failure surface as a user-visible error.
  }
}
