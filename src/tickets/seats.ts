import type { Db } from "../db/pool.js";

export interface SeatStats {
  capacity: number;
  occupied: number;
  available: number;
}

/**
 * The single implementation of R05: occupied = pending + confirmed; available = capacity − occupied,
 * or 0 when the event is cancelled. Pass a transaction client to read under the event row lock.
 */
export async function seatStats(db: Db, eventId: string): Promise<SeatStats | null> {
  const { rows } = await db.query<{ capacity: number; status: string; occupied: string }>(
    `SELECT e.capacity, e.status,
            count(t.id) FILTER (WHERE t.status IN ('pending', 'confirmed')) AS occupied
       FROM events e LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.id`,
    [eventId],
  );
  const row = rows[0];
  if (!row) return null;
  const occupied = Number(row.occupied);
  const available = row.status === "cancelled" ? 0 : Math.max(0, row.capacity - occupied);
  return { capacity: row.capacity, occupied, available };
}
