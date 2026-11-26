import type { FastifyError, FastifyInstance } from "fastify";
import type { FeatureDeps } from "../app.js";
import { listOnSaleEvents } from "../events/index.js";
import { toIsoWithOffset } from "../lib/format.js";
import { getTicket, purchaseTicket, seatStats } from "../tickets/index.js";
import { requirePartnerKey } from "./auth.js";
import { isJsonContentType, parsePurchaseBody } from "./validation.js";

export const PARTNER_PREFIX = "/api/partner";

const INVALID_REQUEST = { error: "invalid_request" } as const;

/** Body-parsing failures (malformed/empty JSON, unsupported media type, too large) become 422. */
function isBodyError(err: FastifyError): boolean {
  return (
    (typeof err.code === "string" && err.code.startsWith("FST_ERR_CTP_")) ||
    err.statusCode === 400 ||
    err.statusCode === 413 ||
    err.statusCode === 415
  );
}

/** Routes are relative to /api/partner; the scope's key hook covers every one of them and its 404s. */
export function partnerRoutes({ pool, config }: FeatureDeps) {
  return async (scope: FastifyInstance) => {
    const keyHook = requirePartnerKey(config.partnerApiKey);
    scope.addHook("onRequest", keyHook);

    scope.setErrorHandler((err: FastifyError, request, reply) => {
      if (isBodyError(err)) return reply.code(422).send(INVALID_REQUEST);
      request.log.error(err);
      return reply.code(500).send({ error: "internal_error" });
    });

    scope.setNotFoundHandler({ preHandler: keyHook }, (_request, reply) =>
      reply.code(404).send({ error: "not_found" }),
    );

    scope.get("/events", async () => {
      const events = await listOnSaleEvents(pool);
      return Promise.all(
        events.map(async (e) => ({
          id: e.id,
          name: e.name,
          startsAt: toIsoWithOffset(e.startsAt),
          priceCents: e.priceCents,
          availableSeats: (await seatStats(pool, e.id))?.available ?? 0,
        })),
      );
    });

    scope.post<{ Params: { eventId: string } }>(
      "/events/:eventId/purchases",
      async (request, reply) => {
        const body = isJsonContentType(request.headers["content-type"])
          ? parsePurchaseBody(request.body)
          : null;
        if (!body) return reply.code(422).send(INVALID_REQUEST);

        const result = await purchaseTicket(pool, config.gatewayDelayScale, {
          eventId: request.params.eventId,
          buyerUserId: null,
          buyerEmail: body.buyerEmail,
          cardNumber: body.cardNumber,
          channel: "partner",
        });
        if (!result.ok) {
          if (result.error === "event_not_available") {
            return reply.code(404).send({ error: "event_not_available" });
          }
          if (result.error === "sold_out") return reply.code(409).send({ error: "sold_out" });
          return reply.code(422).send(INVALID_REQUEST);
        }
        const { ticket } = result;
        return reply
          .code(202)
          .send({ ticketId: ticket.id, code: ticket.code, status: ticket.status });
      },
    );

    scope.get<{ Params: { ticketId: string } }>("/tickets/:ticketId", async (request, reply) => {
      const ticket = await getTicket(pool, request.params.ticketId);
      if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
      return {
        ticketId: ticket.id,
        code: ticket.code,
        eventId: ticket.eventId,
        status: ticket.status,
        checkedIn: ticket.checkedInAt !== null,
      };
    });
  };
}
