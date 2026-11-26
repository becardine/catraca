// Temporary pages owned by F01 until F02 delivers the storefront and the organizer event list.
// F02 deletes this file and registers the real handlers for the same paths.
import type { FastifyInstance } from "fastify";
import { registerOrganizerRoutes } from "../auth/organizer-area.js";
import { html } from "./html.js";
import { renderPage, sendPage } from "./layout.js";

export function registerPlaceholders(app: FastifyInstance): void {
  app.get("/", async (request, reply) =>
    sendPage(
      reply,
      renderPage({
        title: "Vitrine",
        body: html`${request.user ? html`<p>Olá, ${request.user.name}</p>` : ""}
          <p>Nenhum evento à venda no momento.</p>`,
        user: request.user,
      }),
    ),
  );

  registerOrganizerRoutes(app, (scope) => {
    scope.get("/events", async (request, reply) =>
      sendPage(
        reply,
        renderPage({
          title: "Área do organizador",
          body: html`<p>Olá, ${request.user?.name}</p><p>Seus eventos aparecerão aqui.</p>`,
          user: request.user,
        }),
      ),
    );
  });
}
