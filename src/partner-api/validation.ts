export interface PurchaseBody {
  buyerEmail: string;
  cardNumber: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD_RE = /^\d{16}$/;

/** Strict body check for `POST /purchases`; null means `422 invalid_request`. */
export function parsePurchaseBody(body: unknown): PurchaseBody | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { buyerEmail, cardNumber } = body as Record<string, unknown>;
  if (typeof buyerEmail !== "string" || !EMAIL_RE.test(buyerEmail)) return null;
  if (typeof cardNumber !== "string" || !CARD_RE.test(cardNumber)) return null;
  return { buyerEmail, cardNumber };
}

/** True when the request declared `application/json` (parameters such as charset allowed). */
export function isJsonContentType(contentType: string | undefined): boolean {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";
}
