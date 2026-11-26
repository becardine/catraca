import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { Pool } from "../db/pool.js";
import type { HtmlValue } from "../ui/html.js";
import type { EventInput, EventRecord } from "./events.js";

export interface SectionContext {
  event: EventRecord;
  request: FastifyRequest;
  pool: Pool;
}

/** A block rendered on a page, sorted by `order`. Each feature owns its sections. */
export interface PageSection {
  id: string;
  order: number;
  render(ctx: SectionContext): HtmlValue | Promise<HtmlValue>;
}

/**
 * Runs inside updateEvent's transaction, after the event row is locked (SELECT … FOR UPDATE).
 * Returns an error message to reject the update, or null to accept it.
 */
export type EventUpdateValidator = (
  client: PoolClient,
  current: EventRecord,
  next: EventInput,
) => Promise<string | null>;

/** Extension points of F02, created once per app in buildApp and passed to every feature. */
export interface EventsRegistry {
  managementSections: PageSection[];
  eventPageSections: PageSection[];
  updateValidators: EventUpdateValidator[];
}

export function createEventsRegistry(): EventsRegistry {
  return { managementSections: [], eventPageSections: [], updateValidators: [] };
}

/** Adds a section to /organizer/events/:id (F05 check-in, F06 dashboard, F07 cancellation). */
export function registerManagementSection(registry: EventsRegistry, section: PageSection): void {
  registry.managementSections.push(section);
  registry.managementSections.sort((a, b) => a.order - b.order);
}

/** Adds a section to the public /events/:id page (F03 purchase form). */
export function registerEventPageSection(registry: EventsRegistry, section: PageSection): void {
  registry.eventPageSections.push(section);
  registry.eventPageSections.sort((a, b) => a.order - b.order);
}

/** Adds a validator to updateEvent (F03: capacity must stay ≥ occupied seats). */
export function registerEventUpdateValidator(
  registry: EventsRegistry,
  validator: EventUpdateValidator,
): void {
  registry.updateValidators.push(validator);
}

export async function renderSections(sections: PageSection[], ctx: SectionContext) {
  return Promise.all(sections.map((s) => s.render(ctx)));
}
