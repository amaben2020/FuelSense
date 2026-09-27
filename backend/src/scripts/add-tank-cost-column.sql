-- Weighted-average cost of the fuel currently in each virtual tank.
--
-- Nullable on purpose and NOT backfilled: nobody knows what the fuel already
-- sitting in a tank cost, and inventing a number here would be the same
-- mistake the receipt routes were making. The column fills itself the first
-- time each vehicle takes a priced fill.
--
-- Apply with:
--   psql "$DATABASE_URL" -f src/scripts/add-tank-cost-column.sql
ALTER TABLE virtual_tanks
  ADD COLUMN IF NOT EXISTS avg_cost_ngn_per_liter NUMERIC(10, 2);
