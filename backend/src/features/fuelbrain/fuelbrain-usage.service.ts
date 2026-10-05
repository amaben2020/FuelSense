// FuelBrain's monthly allowance, per fleet.
//
// Metered in credits of 1,000 API tokens (input, cache and output alike), so
// the cap tracks what the fleet actually costs rather than how many messages
// it sent: one question that reads a month of trips can cost ten short ones.
// Every model call counts, including answers that failed or were stopped.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../shared/db-helpers';
import { fuelbrainUsage } from '../../config/db/schema';

export const TOKENS_PER_CREDIT = 1000;

/**
 * Charged when a call is cut off before the API reports any usage — the model
 * can think for several seconds before its first event, so Stop pressed early
 * would otherwise cost nothing and be a free way round the cap. Roughly the
 * system prompt plus tool definitions every call sends.
 */
export const UNREPORTED_CALL_TOKENS = 3000;

const monthlyCredits = (): number => {
  const n = Number(process.env.FUELBRAIN_MONTHLY_CREDITS);
  return Number.isFinite(n) && n > 0 ? n : 1000;
};

/** The Lagos calendar month, as 'YYYY-MM'. Stored as text so the boundary
 *  never depends on the database session's time zone. */
export const lagosMonth = (d = new Date()): string =>
  d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).slice(0, 7);

/** First day of next month in Lagos, for "resets on …". */
const nextReset = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

export interface FuelBrainAllowance {
  used_credits: number;
  limit_credits: number;
  remaining_credits: number;
  resets_on: string;
}

export async function allowanceFor(customerId: string): Promise<FuelBrainAllowance> {
  const month = lagosMonth();
  const [row] = await db
    .select({
      tokens: sql<number>`COALESCE(SUM(${fuelbrainUsage.inputTokens} + ${fuelbrainUsage.outputTokens}), 0)::int`,
    })
    .from(fuelbrainUsage)
    .where(and(eq(fuelbrainUsage.customerId, customerId), eq(fuelbrainUsage.month, month)));
  const used = Math.ceil((row?.tokens ?? 0) / TOKENS_PER_CREDIT);
  const limit = monthlyCredits();
  return {
    used_credits: used,
    limit_credits: limit,
    remaining_credits: Math.max(limit - used, 0),
    resets_on: nextReset(month),
  };
}

export async function recordUsage(opts: {
  customerId: string;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  if (opts.inputTokens + opts.outputTokens === 0) return;
  await db.insert(fuelbrainUsage).values({
    customerId: opts.customerId,
    userId: opts.userId,
    month: lagosMonth(),
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
  });
}
