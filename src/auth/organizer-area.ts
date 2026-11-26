import type { FastifyInstance } from "fastify";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import { requireOrganizer } from "./guards.js";

export const ORGANIZER_PREFIX = "/organizer";

/**
 * The only way to add routes under /organizer. The scope's onRequest hook runs requireOrganizer before
 * any handler, so a feature cannot forget the access check (R13). Paths are relative to /organizer.
 */
export function registerOrganizerRoutes(
  app: FastifyInstance,
  routes: (scope: FastifyInstance) => void | Promise<void>,
): void {
  app.register(
    async (scope) => {
      scope.addHook("onRequest", requireOrganizer);
      await routes(scope);
    },
    { prefix: ORGANIZER_PREFIX },
  );
}

/** Unknown /organizer/* paths are guarded too: visitors → /login, participants → 403, organizers → 404. */
export function registerOrganizerNotFound(app: FastifyInstance): void {
  app.register(
    async (scope) => {
      scope.setNotFoundHandler({ preHandler: requireOrganizer }, (request, reply) =>
        sendPage(
          reply,
          renderPage({
            title: "Página não encontrada",
            body: html`<p>Esta página não existe.</p>`,
            user: request.user,
          }),
          404,
        ),
      );
    },
    { prefix: ORGANIZER_PREFIX },
  );
}
