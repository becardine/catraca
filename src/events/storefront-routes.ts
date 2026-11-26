import type { FastifyInstance } from "fastify";
import type { Pool } from "../db/pool.js";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import { getOnSaleEvent, listOnSaleEvents } from "./events.js";
import { type EventsRegistry, renderSections } from "./sections.js";
import { publicEventSummary } from "./views.js";

export function registerStorefrontRoutes(
  app: FastifyInstance,
  { pool, events }: { pool: Pool; events: EventsRegistry },
): void {
  app.get("/", async (request, reply) => {
    const list = await listOnSaleEvents(pool);
    const body = html`
      ${request.user ? html`<p>Olá, ${request.user.name}</p>` : ""}
      ${
        list.length === 0
          ? html`<p>Nenhum evento à venda no momento.</p>`
          : html`<ul class="events">${list.map(
              (e) =>
                html`<li><h2><a href="/events/${e.id}">${e.name}</a></h2>${publicEventSummary(e)}</li>`,
            )}</ul>`
      }`;
    return sendPage(reply, renderPage({ title: "Vitrine", body, user: request.user }));
  });

  app.get<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    const event = await getOnSaleEvent(pool, request.params.id);
    if (!event) {
      return sendPage(
        reply,
        renderPage({
          title: "Evento não encontrado",
          body: html`<p>Este evento não está disponível.</p><p><a href="/">Voltar à vitrine</a></p>`,
          user: request.user,
        }),
        404,
      );
    }
    const sections = await renderSections(events.eventPageSections, { event, request, pool });
    return sendPage(
      reply,
      renderPage({
        title: event.name,
        body: html`${publicEventSummary(event)}${sections}<p><a href="/">Voltar à vitrine</a></p>`,
        user: request.user,
      }),
    );
  });
}
