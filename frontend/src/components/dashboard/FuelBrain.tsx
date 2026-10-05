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
  Maximize2,
  Minimize2,
  PanelLeft,
  SquarePen,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { api, apiUrl, getToken } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

type Msg = { role: 'user' | 'assistant'; content: string };
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

function Markdown({ children }: { children: string }) {
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
        code: (p) => <code className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[0.85em] text-ink" {...p} />,
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
    setStreaming(true);
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let got = '';
    let finished = false;

    const appendToAnswer = (delta: string) => {
      got += delta;
      setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: got }]);
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
            type: 'text' | 'tool' | 'done' | 'error';
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
                            {m.content && <Markdown>{m.content}</Markdown>}
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

      {!(open && expanded) && (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          title="FuelBrain"
          className={`fixed bottom-6 right-4 z-[1260] h-14 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-canvas shadow-[0_8px_30px_-6px_rgba(0,229,153,0.55)] transition hover:scale-[1.03] ${
            open ? 'hidden md:flex' : 'flex'
          }`}
        >
          {open ? <X className="h-5 w-5" /> : <Brain className="h-5 w-5" />}
          <span className="text-sm">FuelBrain</span>
        </button>
      )}
    </>
  );
}
