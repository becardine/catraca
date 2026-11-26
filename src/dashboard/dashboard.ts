import type { Db } from "../db/pool.js";
import { seatStats } from "../tickets/seats.js";

export interface EventDashboard {
  confirmed: number;
  pending: number;
  checkIns: number;
  availableSeats: number;
  revenueCents: number;
  refunded: number;
}

/**
 * R12: every number is computed from tickets when called (no stored counters, AGENTS.md rule 4).
 * Revenue sums each confirmed ticket's price snapshot (rule 3). Declined and cancelled tickets
 * appear in no number; a refunded ticket counts only in `refunded`. Seats come from seatStats (R05).
 */
export async function eventDashboard(db: Db, eventId: string): Promise<EventDashboard> {
  const { rows } = await db.query<{
    confirmed: string;
    pending: string;
    check_ins: string;
    revenue_cents: string;
    refunded: string;
  }>(
    `SELECT count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
            count(*) FILTER (WHERE status = 'pending') AS pending,
            count(*) FILTER (WHERE status = 'confirmed' AND checked_in_at IS NOT NULL) AS check_ins,
            coalesce(sum(price_cents_paid) FILTER (WHERE status = 'confirmed'), 0) AS revenue_cents,
            count(*) FILTER (WHERE status = 'refunded') AS refunded
       FROM tickets
      WHERE event_id = $1`,
    [eventId],
  );
  const row = rows[0];
  const seats = await seatStats(db, eventId);
  return {
    confirmed: Number(row?.confirmed ?? 0),
    pending: Number(row?.pending ?? 0),
    checkIns: Number(row?.check_ins ?? 0),
    availableSeats: seats?.available ?? 0,
    revenueCents: Number(row?.revenue_cents ?? 0),
    refunded: Number(row?.refunded ?? 0),
  };
}
