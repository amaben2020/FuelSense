import 'dotenv/config';

// One-off: converts the `telemetry` heap into a monthly range-partitioned
// table. See telemetry/telemetry-partitions.service.ts for why.
//
//   npm run db:partition-telemetry            # dry run — prints the plan
//   npm run db:partition-telemetry -- --apply
//
// Runs as a single transaction. The rename takes an ACCESS EXCLUSIVE lock, so
// the ingest path waits rather than writing into the wrong table; at the row
// counts this was written for (thousands, not millions) the whole thing holds
// that lock for well under a second. On a table of tens of millions of rows
// the copy inside would take minutes under lock, and a detach-and-attach of
// the existing heap as the first child would be the right shape instead.
//
// Nothing is dropped until the copied row count matches the original inside
// the same transaction; any mismatch, or any error, rolls the lot back and
// leaves the heap exactly as it was.

import { sql } from 'drizzle-orm';
import { db, closePool } from '../config/db';
import { isTelemetryPartitioned, monthBounds, partitionName } from '../features/telemetry/telemetry-partitions.service';

const apply = process.argv.includes('--apply');

const run = async (): Promise<void> => {
  if (await isTelemetryPartitioned()) {
    console.log('telemetry is already partitioned — nothing to do');
    return;
  }

  const span = await db.execute(sql`
    SELECT MIN(recorded_at) AS oldest, MAX(recorded_at) AS newest, COUNT(*)::bigint AS n FROM telemetry
  `);
  const { oldest, newest, n } = span.rows[0] as { oldest: string; newest: string; n: string };
  console.log(`telemetry: ${n} rows, ${oldest} → ${newest}`);

  // Children from the oldest row's month through two months past today.
  const first = new Date(oldest);
  const months: Array<{ year: number; month: number }> = [];
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  while (cursor <= last) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  console.log('children to create:', months.map((m) => partitionName(m.year, m.month)).join(', '), '+ telemetry_default');

  if (!apply) {
    console.log('\ndry run — re-run with --apply to convert');
    return;
  }

  await db.transaction(async (tx) => {
    // The frames FK cannot survive: a partitioned table's unique keys must
    // include the partition column, so telemetry(id) alone is no longer one.
    await tx.execute(sql`
      ALTER TABLE device_frames DROP CONSTRAINT IF EXISTS device_frames_telemetry_id_telemetry_id_fk
    `);

    await tx.execute(sql`ALTER TABLE telemetry RENAME TO telemetry_unpartitioned`);

    // Same columns, defaults and NOT NULLs. Indexes, the primary key and the
    // foreign keys are re-declared below in the shape a partitioned table takes.
    await tx.execute(sql`
      CREATE TABLE telemetry (LIKE telemetry_unpartitioned INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
        PARTITION BY RANGE (recorded_at)
    `);
    // The sequence was owned by the old table's column and would be dropped
    // with it. Move ownership before anything else is torn down.
    await tx.execute(sql`ALTER SEQUENCE telemetry_id_seq OWNED BY telemetry.id`);

    await tx.execute(sql`
      ALTER TABLE telemetry
        ADD CONSTRAINT telemetry_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
        ADD CONSTRAINT telemetry_imei_devices_imei_fk FOREIGN KEY (imei) REFERENCES devices(imei),
        ADD CONSTRAINT telemetry_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    `);

    for (const { year, month } of months) {
      const { from, to } = monthBounds(year, month);
      await tx.execute(
        sql.raw(
          `CREATE TABLE ${partitionName(year, month)} PARTITION OF telemetry
             FOR VALUES FROM ('${from}') TO ('${to}')`
        )
      );
    }
    await tx.execute(sql`CREATE TABLE telemetry_default PARTITION OF telemetry DEFAULT`);

    await tx.execute(sql`INSERT INTO telemetry SELECT * FROM telemetry_unpartitioned`);

    const [before] = (await tx.execute(sql`SELECT COUNT(*)::bigint AS n FROM telemetry_unpartitioned`)).rows as Array<{ n: string }>;
    const [after] = (await tx.execute(sql`SELECT COUNT(*)::bigint AS n FROM telemetry`)).rows as Array<{ n: string }>;
    const [strays] = (await tx.execute(sql`SELECT COUNT(*)::bigint AS n FROM telemetry_default`)).rows as Array<{ n: string }>;
    if (before.n !== after.n) {
      throw new Error(`row count mismatch after copy: ${before.n} original, ${after.n} copied — rolled back`);
    }
    if (Number(strays.n) > 0) {
      throw new Error(`${strays.n} row(s) fell into the DEFAULT child — a month is missing — rolled back`);
    }
    console.log(`copied ${after.n} rows, none in the default child`);

    // Old table goes before the key and indexes are recreated so the names
    // are free — declared earlier, the key would come out as telemetry_pkey1.
    await tx.execute(sql`DROP TABLE telemetry_unpartitioned`);

    await tx.execute(sql`ALTER TABLE telemetry ADD CONSTRAINT telemetry_pkey PRIMARY KEY (id, recorded_at)`);

    // Declared on the parent, so every child — including ones created later
    // by the partition sweep — inherits them.
    await tx.execute(sql`CREATE INDEX idx_telemetry_customer_recorded ON telemetry (customer_id, recorded_at DESC)`);
    await tx.execute(sql`CREATE INDEX idx_telemetry_vehicle_recorded ON telemetry (vehicle_id, recorded_at DESC)`);
    await tx.execute(sql`CREATE INDEX idx_telemetry_imei_recorded ON telemetry (imei, recorded_at DESC)`);
  });

  const check = await db.execute(sql`
    SELECT c.relname AS child, s.n_live_tup AS approx_rows
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE i.inhparent = 'telemetry'::regclass
    ORDER BY c.relname
  `);
  console.log('\nconverted. children:');
  for (const r of check.rows as Array<{ child: string; approx_rows: string }>) {
    console.log(`  ${r.child.padEnd(24)} ~${r.approx_rows} rows`);
  }
};

run()
  .catch((error) => {
    console.error('partition-telemetry failed:', (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
