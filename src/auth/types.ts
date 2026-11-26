export type Role = "organizer" | "participant";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Logged-in user resolved from the session cookie, or null for visitors. */
    user: CurrentUser | null;
  }
}
