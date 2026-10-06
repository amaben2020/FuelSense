import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { authenticateCustomer } from '../auth/auth.middleware';
import { db, drivers } from '../../shared/db-helpers';
import { customers, fleetUsers, fuelbrainActions, fuelbrainMessages, fuelbrainSessions } from '../../config/db/schema';
import { sendMail, isDeliverable } from '../../shared/mailer';
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
    const rows = await db
      .select({ id: fuelbrainMessages.id, role: fuelbrainMessages.role, content: fuelbrainMessages.content })
      .from(fuelbrainMessages)
      .where(eq(fuelbrainMessages.sessionId, owned.id))
      .orderBy(asc(fuelbrainMessages.id));
    const actions = await db
      .select(actionSelect)
      .from(fuelbrainActions)
      .leftJoin(drivers, eq(drivers.id, fuelbrainActions.driverId))
      .where(eq(fuelbrainActions.sessionId, owned.id))
      .orderBy(asc(fuelbrainActions.createdAt));
    res.json({
      messages: rows.map((m) => ({
        role: m.role,
        content: m.content,
        actions: actions.filter((a) => a.message_id === m.id).map(({ message_id: _m, ...a }) => a),
      })),
    });
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
  const usage: { inputTokens: number; outputTokens: number; model?: string } = { inputTokens: 0, outputTokens: 0 };
  const drafted: string[] = [];
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
        userId: req.user.userId ?? null,
        signerName: req.user.name || 'Your fleet manager',
        onAction: (action) => send({ type: 'action', action }),
        drafted,
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
    const saved = await db
      .insert(fuelbrainMessages)
      .values([
        { sessionId: session.id, role: 'user', content: question },
        { sessionId: session.id, role: 'assistant', content: reply },
      ])
      .returning({ id: fuelbrainMessages.id, role: fuelbrainMessages.role });
    const replyId = saved.find((m) => m.role === 'assistant')?.id;
    if (drafted.length && replyId) {
      // Drafts made this turn sit under this reply when the chat is reopened.
      await db
        .update(fuelbrainActions)
        .set({ sessionId: session.id, messageId: replyId })
        .where(inArray(fuelbrainActions.id, drafted));
    }
    await db
      .update(fuelbrainSessions)
      .set({ updatedAt: sql`NOW()` })
      .where(eq(fuelbrainSessions.id, session.id));

    send({
      type: 'done',
      sessionId: session.id,
      title: session.title,
      allowance: await allowanceFor(req.user.customerId),
      model: usage.model ?? null,
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
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

const actionSelect = {
  id: fuelbrainActions.id,
  kind: fuelbrainActions.kind,
  message_id: fuelbrainActions.messageId,
  driver_name: drivers.fullName,
  to: fuelbrainActions.toEmail,
  subject: fuelbrainActions.subject,
  body: fuelbrainActions.body,
  status: fuelbrainActions.status,
};

const DRIVER_EMAILS_PER_DAY = 20;
const DRAFT_TTL_MS = 24 * 3_600_000;

/** The asker's own draft, still waiting. */
async function pendingAction(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({
      id: fuelbrainActions.id,
      toEmail: fuelbrainActions.toEmail,
      subject: fuelbrainActions.subject,
      body: fuelbrainActions.body,
      status: fuelbrainActions.status,
      createdAt: fuelbrainActions.createdAt,
      userId: fuelbrainActions.userId,
    })
    .from(fuelbrainActions)
    .where(and(eq(fuelbrainActions.id, id), eq(fuelbrainActions.customerId, req.user.customerId)));
  if (!row || (row.userId ?? null) !== (req.user.userId ?? null)) return null;
  return row;
}

/**
 * The only way a FuelBrain draft becomes an email: the manager pressing Send.
 * The status flips first and only from 'pending', so a double click or a
 * replayed request cannot send it twice.
 */
router.post('/actions/:id/send', async (req: Request, res: Response) => {
  // The manager may have edited the draft on the card before sending.
  const edited = (req.body ?? {}) as { subject?: unknown; body?: unknown };
  const subject = typeof edited.subject === 'string' ? edited.subject.trim() : null;
  const body = typeof edited.body === 'string' ? edited.body.trim() : null;
  if ((subject != null && (subject.length < 3 || subject.length > 200)) || (body != null && (body.length < 5 || body.length > 5000))) {
    res.status(400).json({ error: 'Keep the subject to 3-200 characters and the message to 5-5000.' });
    return;
  }
  try {
    const action = await pendingAction(req);
    if (!action) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    if (action.status !== 'pending') {
      res.status(409).json({ error: `This message was already ${action.status}.`, status: action.status });
      return;
    }
    if (Date.now() - action.createdAt.getTime() > DRAFT_TTL_MS) {
      res.status(410).json({ error: 'This draft is over a day old. Ask FuelBrain for a fresh one.' });
      return;
    }
    const [account] = await db
      .select({
        name: customers.name,
        company: customers.companyName,
        email: customers.email,
        verifiedAt: customers.emailVerifiedAt,
      })
      .from(customers)
      .where(eq(customers.id, req.user.customerId));
    // An unverified sign-up could be anyone; it must not mail third parties.
    if (!account?.verifiedAt) {
      res.status(403).json({ error: 'Confirm your account email before sending messages to drivers.' });
      return;
    }
    const [{ sentToday }] = await db
      .select({ sentToday: sql<number>`COUNT(*)::int` })
      .from(fuelbrainActions)
      .where(
        and(
          eq(fuelbrainActions.customerId, req.user.customerId),
          eq(fuelbrainActions.status, 'sent'),
          gt(fuelbrainActions.decidedAt, sql`NOW() - INTERVAL '1 day'`)
        )
      );
    if (sentToday >= DRIVER_EMAILS_PER_DAY) {
      res.status(429).json({ error: `Your fleet has sent ${DRIVER_EMAILS_PER_DAY} driver messages today. Try again tomorrow.` });
      return;
    }

    const claimed = await db
      .update(fuelbrainActions)
      .set({
        status: 'sent',
        decidedAt: sql`NOW()`,
        ...(subject != null ? { subject } : {}),
        ...(body != null ? { body } : {}),
      })
      .where(and(eq(fuelbrainActions.id, action.id), eq(fuelbrainActions.status, 'pending')))
      .returning({ id: fuelbrainActions.id });
    if (!claimed.length) {
      res.status(409).json({ error: 'This message was already handled.' });
      return;
    }

    // Replies go to whoever pressed Send.
    let replyTo = account.email;
    if (req.user.userId) {
      const [user] = await db
        .select({ email: fleetUsers.email })
        .from(fleetUsers)
        .where(eq(fleetUsers.id, req.user.userId));
      if (user?.email) replyTo = user.email;
    }
    const fleetName = account.company || account.name;
    const sent = await sendMail({
      to: action.toEmail,
      subject: subject ?? action.subject,
      text: `${body ?? action.body}\n\n—\nSent by ${fleetName} through FuelSense. Reply to this email to answer your manager.`,
      bypassOverride: true,
      replyTo: isDeliverable(replyTo) ? replyTo : undefined,
    });
    if (!sent) {
      await db
        .update(fuelbrainActions)
        .set({ status: 'pending', decidedAt: null })
        .where(eq(fuelbrainActions.id, action.id));
      res.status(502).json({ error: 'The email could not be sent. Try again shortly.' });
      return;
    }
    res.json({ success: true, status: 'sent' });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.post('/actions/:id/cancel', async (req: Request, res: Response) => {
  try {
    const action = await pendingAction(req);
    if (!action) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const done = await db
      .update(fuelbrainActions)
      .set({ status: 'cancelled', decidedAt: sql`NOW()` })
      .where(and(eq(fuelbrainActions.id, action.id), eq(fuelbrainActions.status, 'pending')))
      .returning({ id: fuelbrainActions.id });
    if (!done.length) {
      res.status(409).json({ error: `This message was already ${action.status}.` });
      return;
    }
    res.json({ success: true, status: 'cancelled' });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

async function charge(req: Request, usage: { inputTokens: number; outputTokens: number }) {
  await recordUsage({
    customerId: req.user.customerId,
    userId: req.user.userId ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
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
