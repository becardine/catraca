import type { Pool } from "../db/pool.js";
import { gatewayDecision } from "../gateway/gateway.js";
import { newId, randomToken } from "../lib/ids.js";
import { type SalesChannel, TICKET_COLUMNS, type TicketRecord, toTicket } from "./tickets.js";

export interface PurchaseInput {
  eventId: string;
  buyerUserId: string | null;
  buyerEmail: string;
  cardNumber: unknown;
  channel: SalesChannel;
}

export type PurchaseError = "invalid_card" | "event_not_available" | "sold_out";
export type PurchaseResult =
  | { ok: true; ticket: TicketRecord }
  | { ok: false; error: PurchaseError };

const CARD_RE = /^\d{16}$/;
const CODE_ATTEMPTS = 5;

/**
 * The one purchase path for every channel (AGENTS.md rule 5). Seats are checked and the ticket inserted
 * while holding the event row lock, so concurrent purchases serialize and never oversell (R07).
 * The answer is immediate: the ticket starts pending and the gateway resolves it later (R06).
 */
export async function purchaseTicket(
  pool: Pool,
  gatewayDelayScale: number,
  input: PurchaseInput,
): Promise<PurchaseResult> {
  const cardNumber = typeof input.cardNumber === "string" ? input.cardNumber.trim() : "";
  if (!CARD_RE.test(cardNumber)) return { ok: false, error: "invalid_card" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ev = await client.query<{ capacity: number; status: string; price_cents: number }>(
      "SELECT capacity, status, price_cents FROM events WHERE id = $1 FOR UPDATE",
      [input.eventId],
    );
    const event = ev.rows[0];
    if (!event || event.status !== "published") {
      await client.query("ROLLBACK");
      return { ok: false, error: "event_not_available" };
    }

    const occ = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM tickets
        WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
      [input.eventId],
    );
    if (Number(occ.rows[0]?.n ?? 0) >= event.capacity) {
      await client.query("ROLLBACK");
      return { ok: false, error: "sold_out" };
    }

    let ticket: TicketRecord | null = null;
    for (let attempt = 0; attempt < CODE_ATTEMPTS && !ticket; attempt++) {
      const inserted = await client.query(
        `INSERT INTO tickets (id, event_id, buyer_user_id, buyer_email, code, status, price_cents_paid, channel)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
         ON CONFLICT (code) DO NOTHING
         RETURNING ${TICKET_COLUMNS}`,
        [
          newId("tkt"),
          input.eventId,
          input.buyerUserId,
          input.buyerEmail,
          randomToken(8),
          event.price_cents, // price snapshot (R03)
          input.channel,
        ],
      );
      if (inserted.rows[0]) ticket = toTicket(inserted.rows[0]);
    }
    if (!ticket) throw new Error("could not generate a unique ticket code");

    const decision = gatewayDecision(cardNumber, gatewayDelayScale);
    await client.query(
      `INSERT INTO payment_jobs (ticket_id, approve, card_last4, due_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision / 1000))`,
      [ticket.id, decision.approve, decision.last4, decision.delayMs],
    );
    await client.query("COMMIT");
    return { ok: true, ticket };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
