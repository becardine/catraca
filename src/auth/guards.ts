import type { FastifyReply, FastifyRequest } from "fastify";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import type { Role } from "./types.js";

function forbidden(request: FastifyRequest, reply: FastifyReply, message: string) {
  return sendPage(
    reply,
    renderPage({ title: "Acesso negado", body: html`<p>${message}</p>`, user: request.user }),
    403,
  );
}

function requireRole(role: Role | null, message: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.redirect("/login", 303);
    if (role && request.user.role !== role) return forbidden(request, reply, message);
  };
}

/** Any logged-in user; visitors are redirected to /login. */
export const requireUser = requireRole(null, "");

/** Participants only (purchases, "Meus ingressos"). */
export const requireParticipant = requireRole(
  "participant",
  "Esta área é exclusiva para participantes.",
);

/** Organizers only (the whole /organizer area). */
export const requireOrganizer = requireRole(
  "organizer",
  "A área do organizador é exclusiva para organizadores.",
);
