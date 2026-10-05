import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { authenticateCustomer } from '../auth/auth.middleware';
import { db } from '../../shared/db-helpers';
import { fuelbrainMessages, fuelbrainSessions } from '../../config/db/schema';
import { logAndRespond } from '../../shared/errors';
import { TOOL_ACTIVITY, askFuelBrain, fuelBrainReady } from './fuelbrain.service';
import { UNREPORTED_CALL_TOKENS, allowanceFor, recordUsage } from './fuelbrain-usage.service';

const router = express.Router();
router.use(authenticateCustomer);

const HISTORY_TURNS = 40;
const MAX_QUESTION = 2000;

// Each question can run several model calls; this caps one person's spend.
const askLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as Request).user?.userId ?? (req as Request).user?.customerId ?? 'anon',
  message: { error: 'FuelBrain has answered a lot this hour. Try again shortly.' },
});

/** Sessions belong to the asker: the account holder (no userId) or one fleet user. */
const ownedBy = (req: Request) =>
  and(
    eq(fuelbrainSessions.customerId, req.user.customerId),
    req.user.userId ? eq(fuelbrainSessions.userId, req.user.userId) : isNull(fuelbrainSessions.userId)
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const titleFrom = (q: string) => {
  const t = q.trim().replace(/\s+/g, ' ');
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'New chat';
};

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await db
      .select({
        id: fuelbrainSessions.id,
        title: fuelbrainSessions.title,
        updated_at: fuelbrainSessions.updatedAt,
      })
      .from(fuelbrainSessions)
      .where(ownedBy(req))
      .orderBy(desc(fuelbrainSessions.updatedAt))
      .limit(50);
    res.json({ ready: fuelBrainReady(), allowance: await allowanceFor(req.user.customerId), sessions });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.get('/sessions/:id/messages', async (req: Request, res: Response) => {
  if (!UUID.test(String(req.params.id))) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  try {
    const [owned] = await db
      .select({ id: fuelbrainSessions.id })
      .from(fuelbrainSessions)
      .where(and(eq(fuelbrainSessions.id, String(req.params.id)), ownedBy(req)));
    if (!owned) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }
    const messages = await db
      .select({ role: fuelbrainMessages.role, content: fuelbrainMessages.content })
      .from(fuelbrainMessages)
      .where(eq(fuelbrainMessages.sessionId, owned.id))
      .orderBy(asc(fuelbrainMessages.id));
    res.json({ messages });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  if (!UUID.test(String(req.params.id))) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  try {
    const gone = await db
      .delete(fuelbrainSessions)
      .where(and(eq(fuelbrainSessions.id, String(req.params.id)), ownedBy(req)))
      .returning({ id: fuelbrainSessions.id });
    if (!gone.length) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.post('/chat', askLimiter, async (req: Request, res: Response) => {
  const question = String((req.body ?? {}).message ?? '').trim();
  const requestedSession = (req.body ?? {}).sessionId as string | undefined;
  if (!question) {
    res.status(400).json({ error: 'Ask a question first.' });
    return;
  }
  if (question.length > MAX_QUESTION) {
    res.status(400).json({ error: `Keep questions under ${MAX_QUESTION} characters.` });
    return;
  }
  if (requestedSession && !UUID.test(String(requestedSession))) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  if (!fuelBrainReady()) {
    res.status(503).json({ error: 'FuelBrain is not configured on this server (ANTHROPIC_API_KEY).' });
    return;
  }

  let send: (event: Record<string, unknown>) => void = () => {};
  const usage = { inputTokens: 0, outputTokens: 0 };
  try {
    let session: { id: string; title: string } | undefined;
    if (requestedSession) {
      [session] = await db
        .select({ id: fuelbrainSessions.id, title: fuelbrainSessions.title })
        .from(fuelbrainSessions)
        .where(and(eq(fuelbrainSessions.id, requestedSession), ownedBy(req)));
      if (!session) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
    }

    const history = session
      ? (
          await db
            .select({ role: fuelbrainMessages.role, content: fuelbrainMessages.content })
            .from(fuelbrainMessages)
            .where(eq(fuelbrainMessages.sessionId, session.id))
            .orderBy(desc(fuelbrainMessages.id))
            .limit(HISTORY_TURNS)
        )
          .reverse()
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      : [];
    // A window that opens on an assistant turn is invalid; drop it.
    while (history[0]?.role === 'assistant') history.shift();

    const allowance = await allowanceFor(req.user.customerId);
    if (allowance.remaining_credits <= 0) {
      res.status(429).json({
        error: `Your fleet has used this month's ${allowance.limit_credits} FuelBrain credits. They reset on ${allowance.resets_on}.`,
        allowance,
      });
      return;
    }

    // Server-sent events from here on: the answer streams as it is written,
    // with a line for each tool so a long lookup reads as work in progress.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Closing the panel or pressing Stop ends the model call too, rather than
    // paying for an answer nobody will read.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    let reply: string;
    try {
      reply = await askFuelBrain({
        authorization: req.headers.authorization ?? '',
        customerId: req.user.customerId,
        history,
        question,
        signal: abort.signal,
        usage,
        onText: (delta) => send({ type: 'text', delta }),
        onTool: (name) => send({ type: 'tool', name, label: TOOL_ACTIVITY[name] ?? 'Looking that up' }),
      });
    } catch (error) {
      if (usage.inputTokens === 0) usage.inputTokens = UNREPORTED_CALL_TOKENS;
      await charge(req, usage);
      if (abort.signal.aborted) return;
      send({ type: 'error', message: modelErrorMessage(error) });
      res.end();
      return;
    }
    await charge(req, usage);

    // Written only once the answer exists, so a failed or abandoned call
    // leaves no dangling question that would pair two user turns next time.
    if (!session) {
      [session] = await db
        .insert(fuelbrainSessions)
        .values({
          customerId: req.user.customerId,
          userId: req.user.userId ?? null,
          title: titleFrom(question),
        })
        .returning({ id: fuelbrainSessions.id, title: fuelbrainSessions.title });
    }
    await db.insert(fuelbrainMessages).values([
      { sessionId: session.id, role: 'user', content: question },
      { sessionId: session.id, role: 'assistant', content: reply },
    ]);
    await db
      .update(fuelbrainSessions)
      .set({ updatedAt: sql`NOW()` })
      .where(eq(fuelbrainSessions.id, session.id));

    send({
      type: 'done',
      sessionId: session.id,
      title: session.title,
      allowance: await allowanceFor(req.user.customerId),
    });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      send({ type: 'error', message: 'Something went wrong saving that chat.' });
      res.end();
      console.error('[fuelbrain] chat failed after streaming began:', error);
    } else {
      logAndRespond(res, req.path, error);
    }
  }
});

async function charge(req: Request, usage: { inputTokens: number; outputTokens: number }) {
  await recordUsage({
    customerId: req.user.customerId,
    userId: req.user.userId ?? null,
    ...usage,
  }).catch((err) => console.error('[fuelbrain] usage not recorded:', err));
}

function modelErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'FuelBrain is busy. Try again in a minute.';
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('[fuelbrain] Anthropic credentials rejected');
    return 'FuelBrain is not configured correctly on this server.';
  }
  if (error instanceof Anthropic.APIError) {
    console.error(`[fuelbrain] API error ${error.status}:`, error.message);
    return 'FuelBrain could not reach the model. Try again.';
  }
  console.error('[fuelbrain] chat failed:', error);
  return 'FuelBrain could not answer that. Try again.';
}

export default router;
