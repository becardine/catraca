import type { Db, Pool } from "../db/pool.js";

export interface GatewayDecision {
  approve: boolean;
  last4: string;
  delayMs: number;
}

// Inside the brief's windows (2–5 s, 30–40 s), with room for the worker tick.
const FAST_MS: [number, number] = [2_000, 4_500];
const SLOW_MS: [number, number] = [30_500, 39_000];

/**
 * Simulated gateway (brief table): 0001 approve fast, 0002 decline fast, 0003 approve slow,
 * 0004 decline slow, anything else decline fast. Delay is multiplied by GATEWAY_DELAY_SCALE.
 */
export function gatewayDecision(
  cardNumber: string,
  scale: number,
  random: () => number = Math.random,
): GatewayDecision {
  const last4 = cardNumber.slice(-4);
  const slow = last4 === "0003" || last4 === "0004";
  const approve = last4 === "0001" || last4 === "0003";
  const [min, max] = slow ? SLOW_MS : FAST_MS;
  return { approve, last4, delayMs: Math.round((min + random() * (max - min)) * scale) };
}

/**
 * The only place gateway answers land. Pending-only: a late answer never changes a ticket that is
 * already confirmed, declined, cancelled or refunded (R08, R11). Returns true if the ticket changed.
 */
export async function applyGatewayResult(
  db: Db,
  ticketId: string,
  approved: boolean,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE tickets
        SET status = CASE WHEN $2::boolean THEN 'confirmed' ELSE 'declined' END, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [ticketId, approved],
  );
  return res.rowCount === 1;
}

/** Applies every due job once. SKIP LOCKED lets concurrent workers share the queue safely. */
export async function processDueJobs(pool: Pool, limit = 100): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ ticket_id: string; approve: boolean }>(
      `SELECT ticket_id, approve FROM payment_jobs
        WHERE processed_at IS NULL AND due_at <= now()
        ORDER BY due_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const job of rows) {
      await applyGatewayResult(client, job.ticket_id, job.approve);
      await client.query("UPDATE payment_jobs SET processed_at = now() WHERE ticket_id = $1", [
        job.ticket_id,
      ]);
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
