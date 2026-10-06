// FuelBrain eval runner.
//
//   npm run eval:fuelbrain                 # rebuild fixture, run every case once
//   npm run eval:fuelbrain -- --only rate-quoted-correctly,parked-not-broken
//   npm run eval:fuelbrain -- --reps 2 --out ../.claude/hillclimb/fuelbrain/v1
//   npm run eval:fuelbrain -- --dry-run    # fixture + case list, no model calls
//
// Talks to a running backend (EVAL_API_URL, default http://localhost:5199/api)
// through the real /api/fuelbrain/chat endpoint — the eval measures what the
// app does, not a copy of it. EVAL_DATABASE_URL must be that backend's
// throwaway database: the fixture is rebuilt there before every run.
//
// Deliberately does NOT load backend/.env: its DATABASE_URL is production
// through the SSH tunnel on localhost, which a hostname check alone cannot
// tell apart from a local test database.
import fs from 'fs';
import path from 'path';
import { CASES, grade, type EvalCase, type Outcome } from './cases';
import { FIXTURE, buildFixture } from './fixture';

const EXPECTED_MODEL = 'claude-opus-5-5';
const CASE_CEILING_MS = 180_000;
const MAX_RETRIES = 3;
// Claude Opus 5.5 list prices, $ per million tokens. FuelBrain does not set
// cache_control, so every input token is billed at the base rate.
const PRICE_IN = 4;
const PRICE_OUT = 20;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API = (process.env.EVAL_API_URL || 'http://localhost:5199/api').replace(/\/$/, '');
const OUT = path.resolve(opt('out', path.join(__dirname, '../../../.claude/hillclimb/fuelbrain/baseline')));
const REPS = Math.max(1, Number(opt('reps', '1')));
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '3')));
const ONLY = opt('only', '').split(',').filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Run {
  outcome: Outcome;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latency_s: number;
  retries: number;
  stop: 'done' | 'error';
}

async function login(): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: FIXTURE.email, password: FIXTURE.password }),
  });
  const body = (await res.json()) as { token?: string; error?: string };
  if (!body.token) throw new Error(`Could not sign in to ${API} as the eval fleet: ${body.error ?? res.status}`);
  return body.token;
}

/** One question through the real endpoint, read exactly as the chat UI reads it. */
async function ask(token: string, prompt: string): Promise<Run> {
  const started = Date.now();
  let retries = 0;
  for (;;) {
    const controller = new AbortController();
    const ceiling = setTimeout(() => controller.abort(), CASE_CEILING_MS);
    try {
      const res = await fetch(`${API}/fuelbrain/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: prompt }),
        signal: controller.signal,
      });
      if ((res.status === 429 || res.status >= 500) && retries < MAX_RETRIES) {
        retries += 1;
        clearTimeout(ceiling);
        await sleep(2000 * 2 ** retries + Math.random() * 1000);
        continue;
      }
      if (!res.ok || !res.body) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const outcome: Outcome = { text: '', tools: [], actions: [], error: null };
      let model: string | null = null;
      let usage = { input_tokens: 0, output_tokens: 0 };
      let finished = false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, cut).split('\n').find((l) => l.startsWith('data: '));
          buffer = buffer.slice(cut + 2);
          if (!line) continue;
          const e = JSON.parse(line.slice(6));
          if (e.type === 'text') outcome.text += e.delta;
          else if (e.type === 'tool') outcome.tools.push(e.name);
          else if (e.type === 'action') outcome.actions.push({ subject: e.action.subject, body: e.action.body });
          else if (e.type === 'error') outcome.error = e.message;
          else if (e.type === 'done') {
            finished = true;
            model = e.model ?? null;
            usage = e.usage ?? usage;
          }
        }
      }
      if (!finished && !outcome.error) outcome.error = 'stream ended without a done event';
      return {
        outcome,
        model,
        usage,
        latency_s: (Date.now() - started) / 1000,
        retries,
        stop: finished ? 'done' : 'error',
      };
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`timeout after ${CASE_CEILING_MS / 1000}s`);
      throw err;
    } finally {
      clearTimeout(ceiling);
    }
  }
}

function trace(c: EvalCase, run: Run) {
  return [
    { role: 'system', content: 'FuelBrain system prompt (see backend/src/features/fuelbrain/fuelbrain.service.ts)' },
    { role: 'user', content: c.prompt },
    ...run.outcome.tools.map((name) => ({ role: 'tool_call', name, content: '' })),
    ...run.outcome.actions.map((a) => ({
      role: 'tool_result',
      content: `Draft (not sent)\nSubject: ${a.subject}\n\n${a.body}`,
    })),
    { role: 'assistant', content: run.outcome.text || `(no answer: ${run.outcome.error})` },
  ];
}

/** 95% Wilson interval for a pass rate, so a small set's noise is visible. */
function wilson(passes: number, n: number) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = passes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

async function main() {
  const cases = ONLY.length ? CASES.filter((c) => ONLY.includes(c.id)) : CASES;
  if (!cases.length) throw new Error(`No cases match --only ${ONLY.join(',')}`);

  await buildFixture(process.env.EVAL_DATABASE_URL as string);
  console.log(`Fixture rebuilt. ${cases.length} case(s) × ${REPS} rep(s) against ${API}`);
  if (flag('dry-run')) {
    for (const c of cases) console.log(`  ${c.id.padEnd(32)} ${c.prompt}`);
    return;
  }

  fs.mkdirSync(path.join(OUT, 'traces'), { recursive: true });
  const resultsPath = path.join(OUT, 'results.jsonl');
  const errorsPath = path.join(OUT, 'errors.jsonl');
  fs.writeFileSync(
    path.join(OUT, '_state.json'),
    JSON.stringify(
      {
        metrics: [{ id: 'pass', label: 'Pass', kind: 'binary' }],
        perf_fields: ['latency_s', 'tool_calls', 'usage'],
      },
      null,
      2
    )
  );
  // Resume: a (case, rep) already scored is not paid for twice.
  const done = new Set(
    fs.existsSync(resultsPath)
      ? fs
          .readFileSync(resultsPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const r = JSON.parse(l);
            return `${r.prompt_id}#${r.rep}`;
          })
      : []
  );

  const token = await login();
  const queue = cases.flatMap((c) => Array.from({ length: REPS }, (_, rep) => ({ c, rep })))
    .filter(({ c, rep }) => !done.has(`${c.id}#${rep}`));

  let passes = 0;
  let scored = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let harnessErrors = 0;
  const failures: string[] = [];

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { c, rep } = job;
      try {
        const run = await ask(token, c.prompt);
        tokensIn += run.usage.input_tokens;
        tokensOut += run.usage.output_tokens;
        if (run.stop === 'done' && run.model && run.model !== EXPECTED_MODEL) {
          throw new Error(`served by ${run.model}, expected ${EXPECTED_MODEL}`);
        }
        if (run.stop === 'done' && run.usage.input_tokens === 0) {
          throw new Error('done event carried no usage; the endpoint is not reporting cost');
        }
        const g = grade(c, run.outcome);
        scored += 1;
        if (g.pass) passes += 1;
        else failures.push(`${c.id}: ${g.failures.join('; ')}`);
        fs.appendFileSync(
          resultsPath,
          JSON.stringify({
            prompt_id: c.id,
            rep,
            prompt: c.prompt,
            tags: c.tags,
            status: run.stop === 'done' ? 'ok' : 'error',
            stop_reason: run.stop,
            grade: { pass: g.pass ? 1 : 0 },
            explanation: { pass: g.pass ? 'all checks passed' : g.failures.join('; ') },
            model: run.model,
            usage: run.usage,
            latency_s: Number(run.latency_s.toFixed(1)),
            tool_calls: run.outcome.tools.length,
            meta: { tools: run.outcome.tools, drafts: run.outcome.actions.length, retries: run.retries },
          }) + '\n'
        );
        fs.writeFileSync(path.join(OUT, 'traces', `${c.id}_rep${rep}.json`), JSON.stringify(trace(c, run), null, 2));
        console.log(`${g.pass ? 'PASS' : 'FAIL'}  ${c.id}${REPS > 1 ? ` #${rep}` : ''}  (${run.latency_s.toFixed(0)}s, ${run.outcome.tools.join(', ') || 'no tools'})`);
      } catch (err) {
        // Harness failures never occupy a result slot, so a resume retries them.
        const message = err instanceof Error ? err.message : String(err);
        harnessErrors += 1;
        fs.appendFileSync(errorsPath, JSON.stringify({ prompt_id: c.id, rep, error: message, at: new Date().toISOString() }) + '\n');
        console.log(`ERROR ${c.id}: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const [lo, hi] = wilson(passes, scored);
  const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
  console.log(
    `\n${passes}/${scored} passed (${scored ? Math.round((passes / scored) * 100) : 0}%, 95% CI ${Math.round(lo * 100)}–${Math.round(hi * 100)}%)` +
      ` · ${tokensIn.toLocaleString()} in / ${tokensOut.toLocaleString()} out tokens · ~$${cost.toFixed(2)} at list price` +
      `\nResults: ${resultsPath}`
  );
  if (harnessErrors) console.log(`${harnessErrors} case(s) errored before they could be graded; see ${errorsPath}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  if (harnessErrors || passes < scored) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
