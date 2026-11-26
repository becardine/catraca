import type { Pool } from "../db/pool.js";

export type CancelResult =
  | { ok: true; refunded: number; cancelled: number }
  | { ok: false; error: "not_found" | "not_published" };

/**
 * R11: cancels a published event of this organizer, irreversibly, in ONE transaction:
 * the event becomes `cancelled`, confirmed tickets `refunded`, pending tickets `cancelled`.
 *
 * - Purchases take the same event row lock (F03), so a racing purchase either commits before (and its
 *   pending ticket is cancelled here) or sees `cancelled` afterwards (`event_not_available`).
 * - Gateway answers only update `pending` tickets (F03 `applyGatewayResult`), so a late answer never
 *   overwrites what this transaction wrote. Postgres re-checks each WHERE on the locked ticket row.
 */
export async function cancelEvent(
  pool: Pool,
  organizerId: string,
  eventId: string,
): Promise<CancelResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE",
      [eventId, organizerId],
    );
    const event = rows[0];
    if (!event || event.status !== "published") {
      await client.query("ROLLBACK");
      return { ok: false, error: event ? "not_published" : "not_found" };
    }

    await client.query("UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1", [
      eventId,
    ]);
    const tickets = await client.query<{ status: string }>(
      `UPDATE tickets
          SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END,
              updated_at = now()
        WHERE event_id = $1 AND status IN ('confirmed', 'pending')
        RETURNING status`,
      [eventId],
    );
    await client.query("COMMIT");
    const refunded = tickets.rows.filter((t) => t.status === "refunded").length;
    return { ok: true, refunded, cancelled: tickets.rows.length - refunded };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
