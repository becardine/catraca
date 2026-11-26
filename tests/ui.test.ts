import { describe, expect, it } from "vitest";
import { escapeHtml, html, raw } from "../src/ui/html.js";
import { renderPage } from "../src/ui/layout.js";

describe("html helpers", () => {
  it("escapes interpolated values", () => {
    const name = `<script>alert("x")</script>`;
    expect(html`<p>${name}</p>`.value).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
    expect(escapeHtml("a & 'b'")).toBe("a &amp; &#39;b&#39;");
  });

  it("does not double-escape nested html or raw values and skips empty values", () => {
    const inner = html`<b>${"<i>"}</b>`;
    expect(html`<p>${inner}${raw("<br>")}${null}${false}${[1, 2]}</p>`.value).toBe(
      "<p><b>&lt;i&gt;</b><br>12</p>",
    );
  });
});

describe("renderPage navigation", () => {
  const base = { title: "T", body: "" };

  it("shows login and signup links to visitors", () => {
    const page = renderPage({ ...base, user: null });
    expect(page).toContain('href="/login"');
    expect(page).toContain('href="/signup"');
    expect(page).not.toContain('href="/organizer/events"');
  });

  it("shows the organizer area only to organizers and my tickets only to participants", () => {
    const org = renderPage({
      ...base,
      user: { id: "u1", name: "Org", email: "o@x.com", role: "organizer" },
    });
    const part = renderPage({
      ...base,
      user: { id: "u2", name: "Par", email: "p@x.com", role: "participant" },
    });
    expect(org).toContain('href="/organizer/events"');
    expect(org).not.toContain('href="/my-tickets"');
    expect(part).toContain('href="/my-tickets"');
    expect(part).not.toContain('href="/organizer/events"');
    expect(part).toContain('action="/logout"');
  });
});
