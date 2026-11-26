import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { registerOrganizerRoutes } from "../auth/organizer-area.js";
import type { CurrentUser } from "../auth/types.js";
import type { Pool } from "../db/pool.js";
import { formatDateTime } from "../lib/format.js";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import {
  createEvent,
  EVENT_MESSAGES,
  type EventRecord,
  getOwnedEvent,
  listOwnedEvents,
  publishEvent,
  STATUS_LABELS,
  updateEvent,
} from "./events.js";
import { type EventsRegistry, renderSections } from "./sections.js";
import {
  eventDetails,
  eventForm,
  type FormValues,
  messages,
  NOTICES,
  valuesFromBody,
  valuesFromEvent,
} from "./views.js";

interface Deps {
  pool: Pool;
  events: EventsRegistry;
}

type IdParams = { Params: { id: string } };
type Body = Record<string, unknown>;

/** Same response for "does not exist" and "not yours": no event data leaks (R13). */
function notFound(request: FastifyRequest, reply: FastifyReply) {
  return sendPage(
    reply,
    renderPage({
      title: "Evento não encontrado",
      body: html`<p>Evento não encontrado.</p><p><a href="/organizer/events">Voltar aos meus eventos</a></p>`,
      user: request.user,
    }),
    404,
  );
}

const owner = (request: FastifyRequest) => (request.user as CurrentUser).id;

export function registerOrganizerEventRoutes(app: FastifyInstance, { pool, events }: Deps): void {
  async function managementPage(
    request: FastifyRequest,
    reply: FastifyReply,
    event: EventRecord,
    opts: { status?: number; error?: string; notice?: string; values?: FormValues } = {},
  ) {
    const sections = await renderSections(events.managementSections, { event, request, pool });
    const editable = event.status !== "cancelled";
    const body = html`
      ${messages(opts.error, opts.notice)}
      ${eventDetails(event)}
      ${event.status === "published" ? html`<p><a href="/events/${event.id}">Ver na vitrine</a></p>` : ""}
      ${
        event.status === "draft"
          ? html`<form method="post" action="/organizer/events/${event.id}/publish">
              <button type="submit">Publicar</button></form>`
          : ""
      }
      ${
        editable
          ? html`<section id="edit"><h2>Editar evento</h2>
              ${eventForm(`/organizer/events/${event.id}`, "Salvar alterações", opts.values ?? valuesFromEvent(event))}
            </section>`
          : ""
      }
      ${sections}
      <p><a href="/organizer/events">Voltar aos meus eventos</a></p>`;
    return sendPage(
      reply,
      renderPage({ title: event.name, body, user: request.user }),
      opts.status ?? 200,
    );
  }

  registerOrganizerRoutes(app, (scope) => {
    scope.get("/events", async (request, reply) => {
      const list = await listOwnedEvents(pool, owner(request));
      const body = html`
        <p><a href="/organizer/events/new">Criar evento</a></p>
        ${
          list.length === 0
            ? html`<p>Você ainda não tem eventos.</p>`
            : html`<table>
                <thead><tr><th>Evento</th><th>Início</th><th>Status</th></tr></thead>
                <tbody>${list.map(
                  (e) => html`<tr>
                    <td><a href="/organizer/events/${e.id}">${e.name}</a></td>
                    <td>${formatDateTime(e.startsAt)}</td>
                    <td>${STATUS_LABELS[e.status]}</td></tr>`,
                )}</tbody></table>`
        }`;
      return sendPage(reply, renderPage({ title: "Meus eventos", body, user: request.user }));
    });

    scope.get("/events/new", async (request, reply) =>
      sendPage(
        reply,
        renderPage({
          title: "Criar evento",
          body: eventForm("/organizer/events", "Criar evento"),
          user: request.user,
        }),
      ),
    );

    scope.post<{ Body: Body }>("/events", async (request, reply) => {
      const body = request.body ?? {};
      const result = await createEvent(pool, owner(request), body);
      if (!result.ok) {
        return sendPage(
          reply,
          renderPage({
            title: "Criar evento",
            body: html`${messages(result.error)}${eventForm("/organizer/events", "Criar evento", valuesFromBody(body))}`,
            user: request.user,
          }),
          422,
        );
      }
      return reply.redirect(`/organizer/events/${result.event.id}?notice=created`, 303);
    });

    scope.get<IdParams & { Querystring: { notice?: string } }>(
      "/events/:id",
      async (request, reply) => {
        const event = await getOwnedEvent(pool, owner(request), request.params.id);
        if (!event) return notFound(request, reply);
        const notice = NOTICES[request.query.notice ?? ""];
        return managementPage(request, reply, event, { notice });
      },
    );

    scope.post<IdParams & { Body: Body }>("/events/:id", async (request, reply) => {
      const body = request.body ?? {};
      const result = await updateEvent(pool, events, owner(request), request.params.id, body);
      if (result.ok)
        return reply.redirect(`/organizer/events/${result.event.id}?notice=updated`, 303);
      if (result.error === "not_found") return notFound(request, reply);
      const event = await getOwnedEvent(pool, owner(request), request.params.id);
      if (!event) return notFound(request, reply);
      const status = result.message === EVENT_MESSAGES.cancelledNotEditable ? 409 : 422;
      return managementPage(request, reply, event, {
        status,
        error: result.message,
        values: valuesFromBody(body),
      });
    });

    scope.post<IdParams>("/events/:id/publish", async (request, reply) => {
      const result = await publishEvent(pool, owner(request), request.params.id);
      if (result.ok)
        return reply.redirect(`/organizer/events/${request.params.id}?notice=published`, 303);
      const event = await getOwnedEvent(pool, owner(request), request.params.id);
      if (result.error === "not_found" || !event) return notFound(request, reply);
      return managementPage(request, reply, event, { status: 409, error: EVENT_MESSAGES.notDraft });
    });
  });
}
