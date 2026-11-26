import type { Pool } from "../db/pool.js";
import { getOwnedEvent } from "../events/index.js";
import type { TicketStatus } from "../tickets/tickets.js";

export const CHECKIN_MESSAGES = {
  invalid: "Ingresso inválido para este evento",
  cancelled: "Evento cancelado",
  not_confirmed: "Ingresso não confirmado",
  already_used: "Ingresso já utilizado",
  admitted: "Entrada liberada",
} as const;

export type CheckinResult = keyof typeof CHECKIN_MESSAGES;

/** R10: the first matching rule wins; ownership is checked before any ticket lookup. */
export async function checkIn(
  pool: Pool,
  organizerId: string,
  eventId: string,
  code: string,
): Promise<{ result: CheckinResult } | { error: "not_found" }> {
  const event = await getOwnedEvent(pool, organizerId, eventId);
  if (!event) return { error: "not_found" };

  const { rows } = await pool.query<{
    id: string;
    status: TicketStatus;
    checked_in_at: Date | null;
  }>("SELECT id, status, checked_in_at FROM tickets WHERE event_id = $1 AND code = $2", [
    eventId,
    code.trim().toUpperCase(),
  ]);
  const ticket = rows[0];
  if (!ticket) return { result: "invalid" };
  if (event.status === "cancelled") return { result: "cancelled" };
  if (ticket.status !== "confirmed") return { result: "not_confirmed" };
  if (ticket.checked_in_at !== null) return { result: "already_used" };

  // Only one caller can change this row, even when multiple callers read it as unused.
  const updated = await pool.query(
    `UPDATE tickets SET checked_in_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'confirmed' AND checked_in_at IS NULL`,
    [ticket.id],
  );
  return { result: updated.rowCount === 1 ? "admitted" : "already_used" };
}
