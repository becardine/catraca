import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FeatureDeps } from "../app.js";
import { requireParticipant } from "../auth/guards.js";
import type { CurrentUser } from "../auth/types.js";
import { registerEventPageSection } from "../events/index.js";
import { formatCents } from "../lib/format.js";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import { purchaseTicket } from "./purchase.js";
import { seatStats } from "./seats.js";
import { listTicketsByUser, TICKET_STATUS_LABELS } from "./tickets.js";

export const TICKET_MESSAGES = {
  soldOut: "Ingressos esgotados",
  invalidCard: "Informe um número de cartão com 16 dígitos.",
  purchased: "Compra registrada. O pagamento está sendo processado.",
} as const;

function simplePage(
  request: FastifyRequest,
  reply: FastifyReply,
  title: string,
  message: string,
  status: number,
  eventId?: string,
) {
  return sendPage(
    reply,
    renderPage({
      title,
      body: html`<p class="${status >= 400 ? "error" : "notice"}" role="alert">${message}</p>
        ${eventId ? html`<p><a href="/events/${eventId}">Voltar ao evento</a></p>` : ""}
        <p><a href="/">Voltar à vitrine</a></p>`,
      user: request.user,
    }),
    status,
  );
}

export function registerTicketRoutes(app: FastifyInstance, { pool, config, events }: FeatureDeps) {
  // Purchase block on the public event page (F02 section registry).
  registerEventPageSection(events, {
    id: "purchase",
    order: 10,
    async render({ event, request }) {
      const stats = await seatStats(pool, event.id);
      const available = stats?.available ?? 0;
      if (available === 0) {
        return html`<section id="purchase"><p class="sold-out"><strong>${TICKET_MESSAGES.soldOut}</strong></p></section>`;
      }
      const seats = html`<p>Vagas disponíveis: ${available}</p>`;
      const user = request.user;
      if (!user) {
        return html`<section id="purchase">${seats}
          <p><a href="/login">Entre como participante para comprar</a></p></section>`;
      }
      if (user.role !== "participant") {
        return html`<section id="purchase">${seats}<p>Organizadores não compram ingressos.</p></section>`;
      }
      return html`<section id="purchase">${seats}
        <form method="post" action="/events/${event.id}/purchase">
          <label>Número do cartão
            <input name="cardNumber" inputmode="numeric" pattern="[0-9]{16}" maxlength="16" required></label>
          <button type="submit">Comprar ingresso</button>
        </form></section>`;
    },
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/events/:id/purchase",
    { preHandler: requireParticipant },
    async (request, reply) => {
      const user = request.user as CurrentUser;
      const result = await purchaseTicket(pool, config.gatewayDelayScale, {
        eventId: request.params.id,
        buyerUserId: user.id,
        buyerEmail: user.email,
        cardNumber: request.body?.cardNumber,
        channel: "storefront",
      });
      if (result.ok) return reply.redirect("/my-tickets?notice=purchased", 303);
      if (result.error === "invalid_card") {
        return simplePage(
          request,
          reply,
          "Compra não realizada",
          TICKET_MESSAGES.invalidCard,
          422,
          request.params.id,
        );
      }
      if (result.error === "sold_out") {
        return simplePage(
          request,
          reply,
          "Compra não realizada",
          TICKET_MESSAGES.soldOut,
          409,
          request.params.id,
        );
      }
      return simplePage(
        request,
        reply,
        "Evento não encontrado",
        "Este evento não está disponível.",
        404,
      );
    },
  );

  app.get<{ Querystring: { notice?: string } }>(
    "/my-tickets",
    { preHandler: requireParticipant },
    async (request, reply) => {
      const tickets = await listTicketsByUser(pool, (request.user as CurrentUser).id);
      const notice = request.query.notice === "purchased" ? TICKET_MESSAGES.purchased : "";
      const body = html`
        ${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
        ${
          tickets.length === 0
            ? html`<p>Você ainda não comprou ingressos.</p>`
            : html`<table>
                <thead><tr><th>Evento</th><th>Status</th><th>Código</th><th>Valor pago</th></tr></thead>
                <tbody>${tickets.map(
                  (t) => html`<tr>
                    <td>${t.eventName}</td>
                    <td class="status">${TICKET_STATUS_LABELS[t.status]}</td>
                    <td><code>${t.code}</code></td>
                    <td>${formatCents(t.priceCentsPaid)}</td></tr>`,
                )}</tbody></table>`
        }
        <p>Recarregue a página para ver o status atualizado.</p>`;
      return sendPage(reply, renderPage({ title: "Meus ingressos", body, user: request.user }));
    },
  );
}
