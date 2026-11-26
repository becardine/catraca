import type { FastifyInstance } from "fastify";
import type { FeatureDeps } from "../app.js";
import { registerEventUpdateValidator } from "../events/index.js";
import { registerTicketRoutes } from "./routes.js";
import { seatStats } from "./seats.js";

export * from "./purchase.js";
export * from "./seats.js";
export * from "./tickets.js";

export const capacityBelowOccupied = (occupied: number) =>
  `A lotação não pode ser menor que as vagas ocupadas (${occupied}).`;

/** F03 — purchase, simulated gateway (worker started in main.ts), "Meus ingressos", capacity rule. */
export function registerTickets(app: FastifyInstance, deps: FeatureDeps): void {
  // R03: runs inside F02's updateEvent transaction, after the event row is locked,
  // so no purchase can slip in between this check and the update.
  registerEventUpdateValidator(deps.events, async (client, current, next) => {
    const stats = await seatStats(client, current.id);
    const occupied = stats?.occupied ?? 0;
    return next.capacity < occupied ? capacityBelowOccupied(occupied) : null;
  });

  registerTicketRoutes(app, deps);
}
