import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "../db/pool.js";
import { html } from "../ui/html.js";
import { renderPage, sendPage } from "../ui/layout.js";
import { authenticate, MESSAGES, signupParticipant } from "./accounts.js";
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./sessions.js";
import type { CurrentUser } from "./types.js";

type Form = Record<string, unknown>;

function signupForm(error?: string, values: { name?: string; email?: string } = {}) {
  return html`
    ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
    <form method="post" action="/signup">
      <label>Nome <input name="name" value="${values.name ?? ""}" required></label>
      <label>E-mail <input name="email" type="email" value="${values.email ?? ""}" required></label>
      <label>Senha <input name="password" type="password" minlength="6" required></label>
      <button type="submit">Criar conta</button>
    </form>
    <p>Já tem conta? <a href="/login">Entrar</a></p>`;
}

function loginForm(error?: string, email = "") {
  return html`
    ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
    <form method="post" action="/login">
      <label>E-mail <input name="email" type="email" value="${email}" required></label>
      <label>Senha <input name="password" type="password" required></label>
      <button type="submit">Entrar</button>
    </form>
    <p>Não tem conta? <a href="/signup">Criar conta</a></p>`;
}

async function startSession(pool: Pool, reply: FastifyReply, user: CurrentUser) {
  const token = await createSession(pool, user.id);
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
  });
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function registerAuthRoutes(app: FastifyInstance, { pool }: { pool: Pool }): void {
  app.get("/signup", async (request, reply) =>
    sendPage(reply, renderPage({ title: "Criar conta", body: signupForm(), user: request.user })),
  );

  app.post("/signup", async (request, reply) => {
    const body = (request.body ?? {}) as Form;
    const result = await signupParticipant(pool, body);
    if (!result.ok) {
      const values = { name: str(body.name), email: str(body.email) };
      return sendPage(
        reply,
        renderPage({
          title: "Criar conta",
          body: signupForm(result.error, values),
          user: request.user,
        }),
        422,
      );
    }
    await startSession(pool, reply, result.user);
    return reply.redirect("/", 303);
  });

  app.get("/login", async (request, reply) =>
    sendPage(reply, renderPage({ title: "Entrar", body: loginForm(), user: request.user })),
  );

  app.post("/login", async (request, reply) => {
    const body = (request.body ?? {}) as Form;
    const user = await authenticate(pool, body.email, body.password);
    if (!user) {
      return sendPage(
        reply,
        renderPage({
          title: "Entrar",
          body: loginForm(MESSAGES.invalidCredentials, str(body.email)),
          user: request.user,
        }),
        401,
      );
    }
    await startSession(pool, reply, user);
    return reply.redirect(user.role === "organizer" ? "/organizer/events" : "/", 303);
  });

  app.post("/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(pool, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect("/", 303);
  });
}
