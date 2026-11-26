import { centsToInput, formatCents, formatDateTime, toLocalInput } from "../lib/format.js";
import { type HtmlValue, html } from "../ui/html.js";
import { type EventRecord, STATUS_LABELS } from "./events.js";

export const NOTICES: Record<string, string> = {
  created: "Evento criado como rascunho.",
  updated: "Evento atualizado.",
  published: "Evento publicado.",
};

export type FormValues = Record<string, string>;

export function valuesFromEvent(event: EventRecord): FormValues {
  return {
    name: event.name,
    venue: event.venue,
    startsAt: toLocalInput(event.startsAt),
    capacity: String(event.capacity),
    price: centsToInput(event.priceCents),
  };
}

export function valuesFromBody(body: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  for (const key of ["name", "venue", "startsAt", "capacity", "price"]) {
    const v = body[key];
    out[key] = typeof v === "string" ? v : "";
  }
  return out;
}

export function messages(error?: string, notice?: string): HtmlValue {
  return html`${error ? html`<p class="error" role="alert">${error}</p>` : ""}
    ${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}`;
}

export function eventForm(action: string, submitLabel: string, v: FormValues = {}): HtmlValue {
  return html`<form method="post" action="${action}">
    <label>Nome <input name="name" value="${v.name ?? ""}" required></label>
    <label>Local <input name="venue" value="${v.venue ?? ""}" required></label>
    <label>Data e hora de início <input name="startsAt" type="datetime-local" value="${v.startsAt ?? ""}" required></label>
    <label>Lotação <input name="capacity" type="number" min="1" step="1" value="${v.capacity ?? ""}" required></label>
    <label>Preço (R$) <input name="price" inputmode="decimal" placeholder="100,00" value="${v.price ?? ""}" required></label>
    <button type="submit">${submitLabel}</button>
  </form>`;
}

export function eventDetails(event: EventRecord): HtmlValue {
  return html`<dl>
    <dt>Local</dt><dd>${event.venue}</dd>
    <dt>Início</dt><dd>${formatDateTime(event.startsAt)}</dd>
    <dt>Lotação</dt><dd>${event.capacity}</dd>
    <dt>Preço</dt><dd>${formatCents(event.priceCents)}</dd>
    <dt>Status</dt><dd>${STATUS_LABELS[event.status]}</dd>
  </dl>`;
}

export function publicEventSummary(event: EventRecord): HtmlValue {
  return html`<p>${formatDateTime(event.startsAt)} · ${event.venue} · ${formatCents(event.priceCents)}</p>`;
}
