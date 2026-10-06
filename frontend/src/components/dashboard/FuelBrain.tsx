'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  Brain,
  Check,
  Copy,
  Loader2,
  Mail,
  Send,
  Maximize2,
  Minimize2,
  PanelLeft,
  SquarePen,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { api, apiUrl, getToken } from '@/lib/api';
import { FuelBrainChart, parseChartSpec } from '@/components/dashboard/FuelBrainChart';
import { FuelBrainDiagram } from '@/components/dashboard/FuelBrainDiagram';
import { useAuthStore } from '@/store/authStore';

type DriverAction = {
  id: string;
  kind: 'driver_email';
  driver_name: string | null;
  to: string;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'cancelled';
};
type Msg = { role: 'user' | 'assistant'; content: string; actions?: DriverAction[] };
type Session = { id: string; title: string; updated_at: string };
type Allowance = {
  used_credits: number;
  limit_credits: number;
  remaining_credits: number;
  resets_on: string;
};

const STARTERS = [
  { title: 'Best performing driver', prompt: "Who's my best performing driver this week?" },
  { title: 'Thirstiest vehicle', prompt: 'Which vehicle burned the most fuel this month?' },
  { title: 'Fuel spend', prompt: 'How much did we spend on fuel in the last 30 days?' },
  { title: 'Alerts to act on', prompt: 'Any alerts I should act on today?' },
];

/**
 * Fenced blocks the model can use for pictures: ```chart (JSON, drawn by
 * FuelBrainChart) and ```mermaid (diagrams). While an answer is still
 * streaming a block is half-written, so it shows a placeholder until done.
 */
function CodeBlock({ lang, code, streaming }: { lang: string; code: string; streaming: boolean }) {
  if (lang === 'chart' || lang === 'mermaid') {
    if (streaming) {
      return (
        <div className="my-3 flex h-24 items-center justify-center rounded-xl border border-edge bg-panel text-xs text-ink-dim">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-brand" />
          {lang === 'chart' ? 'Drawing chart…' : 'Drawing diagram…'}
        </div>
      );
    }
    if (lang === 'mermaid') return <FuelBrainDiagram code={code} />;
    const parsed = parseChartSpec(code);
    if ('spec' in parsed) return <FuelBrainChart spec={parsed.spec} />;
    return (
      <div className="my-3 rounded-xl border border-edge bg-panel p-3">
        <p className="mb-2 text-[11px] text-ink-dim">This chart could not be drawn: {parsed.error}</p>
        <pre className="overflow-x-auto text-[12px] text-ink-mid">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <pre className="my-3 overflow-x-auto rounded-xl border border-edge bg-panel p-3 text-[12px]">
      <code className="font-mono text-ink-mid">{code}</code>
    </pre>
  );
}

function Markdown({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (p) => <p className="mb-3 leading-7 last:mb-0" {...p} />,
        ul: (p) => <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0" {...p} />,
        ol: (p) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0" {...p} />,
        li: (p) => <li className="leading-7" {...p} />,
        strong: (p) => <strong className="font-semibold text-ink" {...p} />,
        h1: (p) => <h3 className="mb-2 mt-4 text-base font-semibold text-ink first:mt-0" {...p} />,
        h2: (p) => <h3 className="mb-2 mt-4 text-base font-semibold text-ink first:mt-0" {...p} />,
        h3: (p) => <h4 className="mb-1.5 mt-3 font-semibold text-ink first:mt-0" {...p} />,
        a: (p) => <a className="text-brand underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
        // Block code is drawn by CodeBlock, so <pre> just passes it through.
        pre: ({ children: c }) => <>{c}</>,
        code: ({ className, children: c }) => {
          const text = String(c ?? '').replace(/\n$/, '');
          const lang = /language-(\w+)/.exec(className ?? '')?.[1];
          if (lang || text.includes('\n')) {
            return <CodeBlock lang={lang ?? ''} code={text} streaming={streaming} />;
          }
          return <code className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{c}</code>;
        },
        table: (p) => (
          <div className="mb-3 overflow-x-auto rounded-xl border border-edge last:mb-0">
            <table className="w-full border-collapse text-[13px]" {...p} />
          </div>
        ),
        th: (p) => <th className="border-b border-edge bg-ink/5 px-3 py-2 text-left font-semibold text-ink" {...p} />,
        td: (p) => <td className="border-b border-edge/60 px-3 py-2 tabular-nums" {...p} />,
        hr: () => <hr className="my-4 border-edge" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

/** Today / Yesterday / Previous 7 days / Older, by Lagos calendar day. */
function groupSessions(sessions: Session[]): Array<[string, Session[]]> {
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  const now = new Date();
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  const weekAgo = day(new Date(now.getTime() - 7 * 86_400_000));
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const d = day(new Date(s.updated_at));
    const label =
      d === today ? 'Today' : d === yesterday ? 'Yesterday' : d > weekAgo ? 'Previous 7 days' : 'Older';
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return [...groups.entries()];
}

function greeting(): string {
  const h = Number(
    new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' })
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const formatReset = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

/**
 * A message FuelBrain drafted for a driver. Nothing has been sent: Send is the
 * only thing that mails it, and the server refuses a second send.
 */
function ActionCard({
  action,
  onStatus,
}: {
  action: DriverAction;
  onStatus: (status: DriverAction['status']) => void;
}) {
  const [busy, setBusy] = useState<'send' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(action.subject);
  const [body, setBody] = useState(action.body);

  const decide = async (what: 'send' | 'cancel') => {
    setBusy(what);
    setError(null);
    try {
      const r = await api<{ status: DriverAction['status'] }>(`/fuelbrain/actions/${action.id}/${what}`, {
        method: 'POST',
        body: what === 'send' ? JSON.stringify({ subject, body }) : undefined,
      });
      setEditing(false);
      onStatus(r.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-edge bg-panel">
      <div className="flex items-center gap-2 border-b border-edge px-3.5 py-2.5">
        <Mail className="h-4 w-4 text-brand" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          Email to {action.driver_name ?? 'driver'} <span className="font-normal text-ink-dim">· {action.to}</span>
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            action.status === 'sent'
              ? 'bg-good/15 text-good'
              : action.status === 'cancelled'
                ? 'bg-ink/10 text-ink-dim'
                : 'bg-warn/15 text-warn'
          }`}
        >
          {action.status === 'sent' ? 'Sent' : action.status === 'cancelled' ? 'Not sent' : 'Draft — not sent'}
        </span>
      </div>
      {editing ? (
        <div className="space-y-2 px-3.5 py-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            aria-label="Subject"
            className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-[13px] font-semibold text-ink focus:border-brand/60 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={Math.min(14, Math.max(6, body.split('\n').length + 1))}
            aria-label="Message"
            className="w-full resize-y rounded-lg border border-edge bg-canvas px-3 py-2 text-[13px] leading-6 text-ink-mid focus:border-brand/60 focus:outline-none"
          />
        </div>
      ) : (
        <div className="px-3.5 py-3">
          <p className="text-[13px] font-semibold text-ink">{subject}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-ink-mid">{body}</p>
        </div>
      )}
      {action.status === 'pending' && (
        <div className="flex items-center justify-end gap-2 border-t border-edge px-3.5 py-2.5">
          {error && <p className="mr-auto text-xs text-bad">{error}</p>}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            disabled={busy != null}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-mid hover:bg-ink/5 disabled:opacity-50"
          >
            {editing ? 'Done editing' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => decide('cancel')}
            disabled={busy != null}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-mid hover:bg-ink/5 disabled:opacity-50"
          >
            {busy === 'cancel' ? 'Discarding…' : 'Discard'}
          </button>
          <button
            type="button"
            onClick={() => decide('send')}
            disabled={busy != null || subject.trim().length < 3 || body.trim().length < 5}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-canvas disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {busy === 'send' ? 'Sending…' : 'Send email'}
          </button>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="rounded-md p-1.5 text-ink-dim hover:bg-ink/5 hover:text-ink"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function BrainMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand ${
        size === 'lg' ? 'h-12 w-12' : 'h-7 w-7'
      }`}
    >
      <Brain className={size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'} />
    </span>
  );
}

const FAB_KEY = 'fuelbrain_fab_pos';
const MUTE_KEY = 'fuelbrain_muted';
const EDGE = 16;
const DRAG_THRESHOLD = 5;

const readStored = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the button just forgets its spot.
  }
};

/**
 * Two soft notes when an answer finishes, synthesised rather than shipped as
 * a file. The context is created on the click that sent the question, so the
 * browser's autoplay rule lets it sound later when the answer lands.
 */
function chime(ctx: AudioContext | null) {
  if (!ctx) return;
  const t = ctx.currentTime;
  [
    [659.25, 0],
    [987.77, 0.11],
  ].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.12, t + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.5);
  });
}

/** Keep the launcher fully on screen. */
function clampFab(el: HTMLElement | null, x: number, y: number) {
  const w = el?.offsetWidth ?? 150;
  const h = el?.offsetHeight ?? 56;
  return {
    x: Math.min(Math.max(x, EDGE), window.innerWidth - w - EDGE),
    y: Math.min(Math.max(y, EDGE), window.innerHeight - h - EDGE),
  };
}

/** The nearest side, at the same height — where a dropped launcher settles. */
function snapFab(el: HTMLElement | null, x: number, y: number) {
  const w = el?.offsetWidth ?? 150;
  const side = x + w / 2 < window.innerWidth / 2 ? EDGE : window.innerWidth - w - EDGE;
  return clampFab(el, side, y);
}

/**
 * The floating FuelBrain button. Drag it anywhere so it never sits on top of
 * what the manager is working on; on release it springs to the nearest side
 * and remembers the spot. Movement writes the transform straight to the
 * element once per frame instead of re-rendering on every pointer event,
 * which is what keeps the drag smooth.
 */
function FuelBrainLauncher({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = readStored<{ right: boolean; y: number }>(FAB_KEY);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const put = ({ x, y }: { x: number; y: number }) => {
      pos.current = { x, y };
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    put(
      saved
        ? clampFab(el, saved.right ? window.innerWidth - w - EDGE : EDGE, saved.y)
        : clampFab(el, window.innerWidth - w - EDGE, window.innerHeight - h - 24)
    );
    el.style.visibility = 'visible';

    const onResize = () => put(snapFab(el, pos.current.x, pos.current.y));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame.current);
      endDrag.current?.();
    };
  }, []);

  /**
   * The drag follows the pointer on the window, not the button: a quick
   * flick leaves the button before the first move event, and the button
   * would never see the rest. No pointer capture either — capturing would
   * retarget a plain click away from the button.
   */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    // A drag's trailing click may never come; never let it eat this one.
    suppressClick.current = false;
    el.classList.remove('is-settling');
    const id = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = pos.current.x;
    const oy = pos.current.y;
    let moved = false;

    const put = (x: number, y: number) => {
      pos.current = { x, y };
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        moved = true;
        el.classList.add('is-dragging');
      }
      ev.preventDefault();
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const next = clampFab(el, ox + dx, oy + dy);
        put(next.x, next.y);
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      finish();
      if (!moved) return;
      suppressClick.current = true;
      cancelAnimationFrame(frame.current);
      el.classList.add('is-settling');
      const next = snapFab(el, pos.current.x, pos.current.y);
      put(next.x, next.y);
      writeStored(FAB_KEY, { right: next.x > window.innerWidth / 2, y: next.y });
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.classList.remove('is-dragging');
      endDrag.current = null;
    };
    endDrag.current?.();
    endDrag.current = finish;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={ref}
      className="fb-fab"
      style={{ visibility: 'hidden' }}
      onPointerDown={startDrag}
      /* On the wrapper, not the button, so the drag-ending click is caught
         wherever it lands; a button click or Enter bubbles up here. */
      onClick={() => {
        // The click that ends a drag is not a request to open.
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onOpen();
      }}
    >
      <button
        type="button"
        title="FuelBrain — drag to move"
        aria-label="Open FuelBrain"
        className="flex h-[52px] cursor-[inherit] items-center gap-2 rounded-full bg-brand px-5 font-semibold text-canvas"
      >
        <Brain className="h-5 w-5" />
        <span className="text-sm">FuelBrain</span>
      </button>
    </div>
  );
}

/**
 * FuelBrain: a Claude-style chat over the fleet's own data.
 *
 * A floating button opens a window with past chats down the side and the
 * conversation in a reading column. Answers stream in as they are written,
 * with a line saying which part of the fleet is being read while a tool runs.
 * Each fleet has a monthly credit allowance, shown under the chat list.
 */
export function FuelBrain() {
  const customer = useAuthStore((s) => s.customer);
  const firstName = (customer?.user?.name || customer?.name || '').split(' ')[0];

  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() =>
    typeof window === 'undefined' ? false : readStored<boolean>(MUTE_KEY) === true
  );
  const audioRef = useRef<AudioContext | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [ready, setReady] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const d = await api<{ ready: boolean; allowance: Allowance; sessions: Session[] }>(
        '/fuelbrain/sessions'
      );
      setSessions(d.sessions);
      setAllowance(d.allowance);
      setReady(d.ready);
    } catch {
      // History is a convenience; the chat still works without it.
    }
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, activity]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Grow the composer with its content, up to a cap, like a chat app should.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, open]);

  const toggleOpen = () => {
    if (!open) {
      void loadSessions();
      // A phone has no room for the list beside the chat.
      setSidebar(window.innerWidth >= 768);
    }
    setOpen(!open);
  };

  const newChat = () => {
    abortRef.current?.abort();
    setSessionId(null);
    setTitle(null);
    setMessages([]);
    setError(null);
    if (window.innerWidth < 768) setSidebar(false);
    inputRef.current?.focus();
  };

  const openSession = async (s: Session) => {
    abortRef.current?.abort();
    setError(null);
    if (window.innerWidth < 768) setSidebar(false);
    try {
      const d = await api<{ messages: Msg[] }>(`/fuelbrain/sessions/${s.id}/messages`);
      setSessionId(s.id);
      setTitle(s.title);
      setMessages(d.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that chat.');
    }
  };

  const deleteSession = async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === sessionId) newChat();
    await api(`/fuelbrain/sessions/${id}`, { method: 'DELETE' }).catch(() => void loadSessions());
  };

  const stop = () => abortRef.current?.abort();

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    setInput('');
    setError(null);
    setActivity('Thinking');
    if (!muted && !audioRef.current && typeof window !== 'undefined' && 'AudioContext' in window) {
      audioRef.current = new AudioContext();
    }
    void audioRef.current?.resume().catch(() => {});
    setStreaming(true);
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let got = '';
    let acts: DriverAction[] = [];
    let finished = false;

    const showReply = () =>
      setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: got, actions: acts }]);
    const appendToAnswer = (delta: string) => {
      got += delta;
      showReply();
    };

    try {
      const res = await fetch(apiUrl('/fuelbrain/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
        body: JSON.stringify({ message: question, sessionId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; allowance?: Allowance };
        if (body.allowance) setAllowance(body.allowance);
        throw new Error(body.error || `FuelBrain could not answer (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type: 'text' | 'tool' | 'action' | 'done' | 'error';
            action?: Omit<DriverAction, 'status'>;
            delta?: string;
            label?: string;
            message?: string;
            sessionId?: string;
            title?: string;
            allowance?: Allowance;
          };
          if (event.type === 'text' && event.delta) {
            setActivity(null);
            appendToAnswer(event.delta);
          } else if (event.type === 'action' && event.action) {
            acts = [...acts, { ...event.action, status: 'pending' }];
            showReply();
          } else if (event.type === 'tool') {
            setActivity(event.label ?? 'Looking that up');
          } else if (event.type === 'done') {
            finished = true;
            setSessionId(event.sessionId ?? null);
            setTitle(event.title ?? null);
            if (event.allowance) setAllowance(event.allowance);
          } else if (event.type === 'error') {
            throw new Error(event.message || 'FuelBrain could not answer.');
          }
        }
      }
      if (!finished) throw new Error('The answer was cut off. Try again.');
      if (!muted) chime(audioRef.current);
      void loadSessions();
    } catch (err) {
      const stopped = controller.signal.aborted;
      // Nothing is saved server-side for an unfinished answer, so take the
      // turn back off the screen; a stopped one goes back in the box to edit.
      setMessages((prev) => prev.slice(0, -2));
      setInput(question);
      if (!stopped) setError(err instanceof Error ? err.message : 'FuelBrain could not answer.');
      void loadSessions();
    } finally {
      setStreaming(false);
      setActivity(null);
      abortRef.current = null;
    }
  };

  const outOfCredits = allowance != null && allowance.remaining_credits <= 0;
  const canSend = ready && !outOfCredits && !!input.trim() && !streaming;
  const empty = messages.length === 0;

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (streaming) stop();
        else void ask(input);
      }}
      className="rounded-2xl border border-edge bg-panel shadow-lg transition focus-within:border-brand/50"
    >
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) void ask(input);
          }
        }}
        rows={1}
        maxLength={2000}
        disabled={!ready || outOfCredits}
        placeholder={
          outOfCredits
            ? 'Monthly credits used up'
            : empty
              ? 'Ask about your drivers, vehicles, fuel or alerts…'
              : 'Reply to FuelBrain…'
        }
        className="block max-h-[200px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 text-ink placeholder-ink-dim focus:outline-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <p className="truncate pl-1 text-[11px] text-ink-dim">
          {allowance
            ? `${allowance.remaining_credits.toLocaleString()} of ${allowance.limit_credits.toLocaleString()} credits left this month`
            : 'Enter to send · Shift + Enter for a new line'}
        </p>
        <button
          type="submit"
          disabled={!streaming && !canSend}
          title={streaming ? 'Stop' : 'Send'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-canvas transition disabled:opacity-30"
        >
          {streaming ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="FuelBrain"
          className={`fixed z-[1250] flex overflow-hidden border-edge bg-canvas shadow-2xl ${
            expanded
              ? 'inset-0 md:inset-6 md:rounded-2xl md:border'
              : 'inset-0 md:inset-auto md:bottom-24 md:right-4 md:h-[min(720px,calc(100vh-8rem))] md:w-[min(960px,calc(100vw-2rem))] md:rounded-2xl md:border'
          }`}
        >
          {/* Chat list. On a phone it slides over the conversation, so a tap
              beside it closes it. */}
          {sidebar && (
            <button
              type="button"
              aria-label="Hide chats"
              onClick={() => setSidebar(false)}
              className="absolute inset-0 z-[5] bg-black/50 md:hidden"
            />
          )}
          {sidebar && (
            <aside className="absolute inset-y-0 left-0 z-10 flex w-72 flex-col border-r border-edge bg-panel md:static md:w-64">
              <div className="flex items-center justify-between px-3 pb-2 pt-3">
                <div className="flex items-center gap-2 px-1">
                  <BrainMark />
                  <span className="text-sm font-semibold text-ink">FuelBrain</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebar(false)}
                  title="Hide chats"
                  className="rounded-lg p-1.5 text-ink-dim hover:bg-ink/5 hover:text-ink"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={newChat}
                  className="flex w-full items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-sm font-medium text-brand hover:bg-brand/15"
                >
                  <SquarePen className="h-4 w-4" /> New chat
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-2 pb-2">
                {sessions.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-ink-dim">Your chats will appear here.</p>
                ) : (
                  groupSessions(sessions).map(([label, items]) => (
                    <div key={label} className="mb-3">
                      <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-ink-dim">{label}</p>
                      {items.map((s) => (
                        <div
                          key={s.id}
                          className={`group flex items-center rounded-lg ${
                            s.id === sessionId ? 'bg-ink/10' : 'hover:bg-ink/5'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openSession(s)}
                            className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-ink-mid group-hover:text-ink"
                          >
                            {s.title}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSession(s.id)}
                            title="Delete chat"
                            className="mr-1 rounded p-1.5 text-ink-dim opacity-0 hover:text-bad focus:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </nav>
              {allowance && (
                <div className="border-t border-edge px-4 py-3">
                  <div className="mb-1.5 flex justify-between text-[11px] text-ink-dim">
                    <span>Monthly credits</span>
                    <span className="tabular-nums">
                      {allowance.used_credits.toLocaleString()} / {allowance.limit_credits.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className={`h-full rounded-full ${
                        allowance.remaining_credits <= allowance.limit_credits * 0.1 ? 'bg-warn' : 'bg-brand'
                      }`}
                      style={{
                        width: `${Math.min((allowance.used_credits / allowance.limit_credits) * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-dim">Resets {formatReset(allowance.resets_on)}</p>
                </div>
              )}
            </aside>
          )}

          {/* Conversation */}
          <section className="relative flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-1 px-3 py-2.5">
              {!sidebar && (
                <>
                  <button
                    type="button"
                    onClick={() => setSidebar(true)}
                    title="Show chats"
                    className="rounded-lg p-2 text-ink-dim hover:bg-ink/5 hover:text-ink"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={newChat}
                    title="New chat"
                    className="rounded-lg p-2 text-ink-dim hover:bg-ink/5 hover:text-ink"
                  >
                    <SquarePen className="h-4 w-4" />
                  </button>
                </>
              )}
              <p className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-ink">
                {title ?? (empty ? '' : 'New chat')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMuted((m) => {
                    writeStored(MUTE_KEY, !m);
                    return !m;
                  });
                }}
                title={muted ? 'Sound off — click to play a sound when answers finish' : 'Sound on'}
                aria-pressed={!muted}
                className="rounded-lg p-2 text-ink-dim hover:bg-ink/5 hover:text-ink"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Shrink' : 'Expand'}
                className="hidden rounded-lg p-2 text-ink-dim hover:bg-ink/5 hover:text-ink md:block"
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                className="rounded-lg p-2 text-ink-dim hover:bg-ink/5 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {empty ? (
              <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10">
                <div className="w-full max-w-2xl">
                  <div className="mb-6 flex flex-col items-center gap-3 text-center">
                    <BrainMark size="lg" />
                    <h2 className="text-2xl font-semibold text-ink">
                      {greeting()}
                      {firstName ? `, ${firstName}` : ''}
                    </h2>
                    <p className="text-sm text-ink-dim">
                      Ask about your drivers, vehicles, fuel and alerts. I read your trackers and receipts.
                    </p>
                  </div>
                  {composer}
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s.title}
                        type="button"
                        onClick={() => ask(s.prompt)}
                        disabled={!ready || outOfCredits}
                        className="rounded-xl border border-edge bg-panel px-3.5 py-2.5 text-left transition hover:border-brand/40 disabled:opacity-50"
                      >
                        <p className="text-[13px] font-medium text-ink">{s.title}</p>
                        <p className="truncate text-xs text-ink-dim">{s.prompt}</p>
                      </button>
                    ))}
                  </div>
                  {!ready && (
                    <p className="mt-3 text-center text-xs text-warn">
                      FuelBrain is not switched on for this server yet.
                    </p>
                  )}
                  {error && <p className="mt-3 text-center text-xs text-bad">{error}</p>}
                </div>
              </div>
            ) : (
              <>
                <div ref={scroller} className="flex-1 overflow-y-auto">
                  <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-6 pt-2">
                    {messages.map((m, i) => {
                      const isLast = i === messages.length - 1;
                      if (m.role === 'user') {
                        return (
                          <div key={i} className="flex justify-end">
                            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink/10 px-4 py-2.5 text-[15px] leading-6 text-ink">
                              {m.content}
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className="flex gap-3">
                          <BrainMark />
                          <div className="min-w-0 flex-1 pt-0.5 text-[15px] text-ink-mid">
                            {isLast && streaming && activity && (
                              <p className="mb-2 flex items-center gap-2 text-sm text-ink-dim">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                                {activity}…
                              </p>
                            )}
                            {m.content && <Markdown streaming={isLast && streaming}>{m.content}</Markdown>}
                            {m.actions?.map((a) => (
                              <ActionCard
                                key={a.id}
                                action={a}
                                onStatus={(status) =>
                                  setMessages((prev) =>
                                    prev.map((msg) =>
                                      msg.actions?.some((x) => x.id === a.id)
                                        ? { ...msg, actions: msg.actions.map((x) => (x.id === a.id ? { ...x, status } : x)) }
                                        : msg
                                    )
                                  )
                                }
                              />
                            ))}
                            {isLast && streaming && !activity && (
                              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand align-middle" />
                            )}
                            {!(isLast && streaming) && m.content && (
                              <div className="mt-1 -ml-1.5 flex">
                                <CopyButton text={m.content} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mx-auto w-full max-w-2xl px-4 pb-3">
                  {error && (
                    <p className="mb-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                      {error}
                    </p>
                  )}
                  {composer}
                  <p className="mt-2 text-center text-[11px] text-ink-dim">
                    FuelBrain reads your fleet data and can make mistakes. Check key figures on the dashboard.
                  </p>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* Hidden while the chat is open: the window has its own close button,
          and a button floating over the conversation would cover it. */}
      {!open && <FuelBrainLauncher onOpen={toggleOpen} />}
    </>
  );
}
