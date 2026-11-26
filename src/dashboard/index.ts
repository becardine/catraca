import type { FastifyInstance } from "fastify";
import type { FeatureDeps } from "../app.js";
import { registerManagementSection } from "../events/index.js";
import { formatCents } from "../lib/format.js";
import { html } from "../ui/html.js";
import { eventDashboard } from "./dashboard.js";

export * from "./dashboard.js";

/**
 * F06 — dashboard section on the management page (first section). F02 renders management
 * sections only for the event's owner, so no ownership check is needed here (R13).
 */
export function registerDashboard(_app: FastifyInstance, deps: FeatureDeps): void {
  registerManagementSection(deps.events, {
    id: "dashboard",
    order: 10,
    async render({ event, pool }) {
      const d = await eventDashboard(pool, event.id);
      return html`<section id="dashboard"><h2>Painel</h2><dl>
<dt>Confirmados</dt><dd data-metric="confirmed">${d.confirmed}</dd>
<dt>Pendentes</dt><dd data-metric="pending">${d.pending}</dd>
<dt>Check-ins</dt><dd data-metric="checkIns">${d.checkIns}</dd>
<dt>Vagas disponíveis</dt><dd data-metric="availableSeats">${d.availableSeats}</dd>
<dt>Receita</dt><dd data-metric="revenue">${formatCents(d.revenueCents)}</dd>
<dt>Estornados</dt><dd data-metric="refunded">${d.refunded}</dd>
</dl></section>`;
    },
  });
}
