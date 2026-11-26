/**
 * Parses application/x-www-form-urlencoded bodies. Browsers send UTF-8 percent-encoding; some clients
 * (e.g. curl on Windows) send Latin-1 (`ã` → `%E3`). Each value is decoded as UTF-8 and, if that is not
 * valid UTF-8, as Latin-1, so accented names survive either way.
 */
export function decodeFormComponent(component: string): string {
  const text = component.replaceAll("+", " ");
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/(%[0-9a-fA-F]{2})+/g, (run) => {
      const bytes = run.match(/%[0-9a-fA-F]{2}/g) ?? [];
      return bytes.map((b) => String.fromCharCode(Number.parseInt(b.slice(1), 16))).join("");
    });
  }
}

export function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeFormComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? "" : decodeFormComponent(pair.slice(eq + 1));
    if (!(key in out)) out[key] = value; // first value wins
  }
  return out;
}
