import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FeatureDeps } from "../app.js";
import { registerOrganizerRoutes } from "../auth/organizer-area.js";
import type { CurrentUser } from "../auth/types.js";
import { getOwnedEvent, registerManagementSection } from "../events/index.js";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import { cancelEvent } from "./cancel.js";

export * from "./cancel.js";

export const CANCELLATION_MESSAGES = {
  cancelledNotice: "Este evento foi cancelado. Não é possível editá-lo nem republicá-lo.",
  onlyPublished: "Só é possível cancelar um evento publicado.",
} as const;

function page(
  request: FastifyRequest,
  reply: FastifyReply,
  title: string,
  body: string,
  status: number,
) {
  return sendPage(
    reply,
    renderPage({
      title,
      body: html`<p class="error" role="alert">${body}</p>
        <p><a href="/organizer/events">Voltar aos meus eventos</a></p>`,
      user: request.user,
    }),
    status,
  );
}

/** F07 — event cancellation (management section + route). */
export function registerCancellation(app: FastifyInstance, { pool, events }: FeatureDeps): void {
  registerManagementSection(events, {
    id: "cancellation",
    order: 30,
    render({ event }) {
      if (event.status === "cancelled") {
        return html`<section id="cancellation"><p class="notice" role="status"><strong>${CANCELLATION_MESSAGES.cancelledNotice}</strong></p></section>`;
      }
      if (event.status !== "published") return "";
      return html`<section id="cancellation"><h2>Cancelamento</h2>
        <p>Cancelar é irreversível: o evento sai da vitrine, os ingressos confirmados são estornados e os pendentes, cancelados.</p>
        <form method="post" action="/organizer/events/${event.id}/cancel">
          <button type="submit">Cancelar evento</button>
        </form></section>`;
    },
  });

  registerOrganizerRoutes(app, (scope) => {
    scope.post<{ Params: { id: string } }>("/events/:id/cancel", async (request, reply) => {
      const organizerId = (request.user as CurrentUser).id;
      const result = await cancelEvent(pool, organizerId, request.params.id);
      if (result.ok)
        return reply.redirect(`/organizer/events/${request.params.id}?notice=cancelled`, 303);
      if (result.error === "not_published") {
        const event = await getOwnedEvent(pool, organizerId, request.params.id);
        return page(
          request,
          reply,
          event?.name ?? "Evento",
          CANCELLATION_MESSAGES.onlyPublished,
          409,
        );
      }
      return page(request, reply, "Evento não encontrado", "Evento não encontrado.", 404);
    });
  });
}
