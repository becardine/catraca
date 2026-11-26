import type { FastifyReply } from "fastify";
import type { CurrentUser } from "../auth/types.js";
import { type HtmlValue, html, type SafeHtml } from "./html.js";

export interface PageOptions {
  title: string;
  body: HtmlValue;
  user: CurrentUser | null;
}

function nav(user: CurrentUser | null): SafeHtml {
  const links: HtmlValue[] = [html`<a href="/">Vitrine</a>`];
  if (user?.role === "participant") links.push(html`<a href="/my-tickets">Meus ingressos</a>`);
  if (user?.role === "organizer") {
    links.push(html`<a href="/organizer/events">Área do organizador</a>`);
  }
  if (user) {
    links.push(
      html`<span>${user.name}</span>
        <form method="post" action="/logout" class="inline"><button type="submit">Sair</button></form>`,
    );
  } else {
    links.push(html`<a href="/login">Entrar</a>`, html`<a href="/signup">Criar conta</a>`);
  }
  return html`<nav>${links.map((l) => html`${l} `)}</nav>`;
}

/** Full HTML document with the shared navigation. */
export function renderPage({ title, body, user }: PageOptions): string {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Catraca</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 1rem; }
    nav { display: flex; gap: 1rem; align-items: center; border-bottom: 1px solid #ddd; padding-bottom: .5rem; }
    form.inline { display: inline; }
    label { display: block; margin: .5rem 0; }
    .error { color: #b00020; }
    .notice { color: #1b5e20; }
  </style>
</head>
<body>
  ${nav(user)}
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`.value;
}

export function sendPage(reply: FastifyReply, page: string, status = 200): FastifyReply {
  return reply.code(status).type("text/html; charset=utf-8").send(page);
}
