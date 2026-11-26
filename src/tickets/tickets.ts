import type { Db } from "../db/pool.js";

export type TicketStatus = "pending" | "confirmed" | "declined" | "cancelled" | "refunded";
export type SalesChannel = "storefront" | "partner";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: "pendente",
  confirmed: "confirmado",
  declined: "recusado",
  cancelled: "cancelado",
  refunded: "estornado",
};

export interface TicketRecord {
  id: string;
  eventId: string;
  buyerUserId: string | null;
  buyerEmail: string;
  code: string;
  status: TicketStatus;
  priceCentsPaid: number;
  channel: SalesChannel;
  checkedInAt: Date | null;
  createdAt: Date;
}

interface TicketRow {
  id: string;
  event_id: string;
  buyer_user_id: string | null;
  buyer_email: string;
  code: string;
  status: TicketStatus;
  price_cents_paid: number;
  channel: SalesChannel;
  checked_in_at: Date | null;
  created_at: Date;
}

export const TICKET_COLUMNS =
  "id, event_id, buyer_user_id, buyer_email, code, status, price_cents_paid, channel, checked_in_at, created_at";

export function toTicket(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    buyerUserId: row.buyer_user_id,
    buyerEmail: row.buyer_email,
    code: row.code,
    status: row.status,
    priceCentsPaid: row.price_cents_paid,
    channel: row.channel,
    checkedInAt: row.checked_in_at,
    createdAt: row.created_at,
  };
}

export async function getTicket(db: Db, ticketId: string): Promise<TicketRecord | null> {
  const { rows } = await db.query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1`,
    [ticketId],
  );
  return rows[0] ? toTicket(rows[0]) : null;
}

export async function findTicketByCode(db: Db, code: string): Promise<TicketRecord | null> {
  const { rows } = await db.query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE code = $1`,
    [code.trim().toUpperCase()],
  );
  return rows[0] ? toTicket(rows[0]) : null;
}

export interface MyTicket extends TicketRecord {
  eventName: string;
}

/** A participant's own storefront tickets, newest first (partner tickets have no user). */
export async function listTicketsByUser(db: Db, userId: string): Promise<MyTicket[]> {
  const { rows } = await db.query<TicketRow & { event_name: string }>(
    `SELECT t.id, t.event_id, t.buyer_user_id, t.buyer_email, t.code, t.status, t.price_cents_paid,
            t.channel, t.checked_in_at, t.created_at, e.name AS event_name
       FROM tickets t JOIN events e ON e.id = t.event_id
      WHERE t.buyer_user_id = $1
      ORDER BY t.created_at DESC, t.id`,
    [userId],
  );
  return rows.map((r) => ({ ...toTicket(r), eventName: r.event_name }));
}
