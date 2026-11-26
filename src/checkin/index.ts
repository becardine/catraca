import type { FastifyInstance } from "fastify";
import type { FeatureDeps } from "../app.js";
import { registerOrganizerRoutes } from "../auth/organizer-area.js";
import type { CurrentUser } from "../auth/types.js";
import { registerManagementSection } from "../events/index.js";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import { CHECKIN_MESSAGES, type CheckinResult, checkIn } from "./checkin.js";

export * from "./checkin.js";

export function registerCheckin(app: FastifyInstance, { pool, events }: FeatureDeps): void {
  registerManagementSection(events, {
    id: "checkin",
    order: 20,
    render({ event, request }) {
      const key = (request.query as { checkin?: unknown }).checkin;
      const message =
        typeof key === "string" && Object.hasOwn(CHECKIN_MESSAGES, key)
          ? CHECKIN_MESSAGES[key as CheckinResult]
          : null;
      return html`<section id="checkin"><h2>Check-in</h2>
        ${message ? html`<p class="checkin-result" role="status">${message}</p>` : ""}
        <form method="post" action="/organizer/events/${event.id}/checkin">
          <label>Código do ingresso <input name="code"></label>
          <button type="submit">Validar ingresso</button>
        </form></section>`;
    },
  });

  registerOrganizerRoutes(app, (scope) => {
    scope.post<{ Params: { id: string }; Body: { code?: unknown } }>(
      "/events/:id/checkin",
      async (request, reply) => {
        const code = typeof request.body?.code === "string" ? request.body.code : "";
        const result = await checkIn(
          pool,
          (request.user as CurrentUser).id,
          request.params.id,
          code,
        );
        if ("error" in result) {
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
        return reply.redirect(
          `/organizer/events/${request.params.id}?checkin=${result.result}#checkin`,
          303,
        );
      },
    );
  });
}
