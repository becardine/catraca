export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  partnerApiKey: string;
  /** Only "simulated" exists in the MVP; there is no real gateway integration. */
  gatewayMode: "simulated";
  /** Multiplier for simulated gateway delays. 1 = brief timings (default, used by the evaluator). */
  gatewayDelayScale: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const gatewayDelayScale = Number(env.GATEWAY_DELAY_SCALE ?? 1);
  if (!Number.isFinite(gatewayDelayScale) || gatewayDelayScale < 0) {
    throw new Error("GATEWAY_DELAY_SCALE must be a non-negative number");
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL ?? "postgres://catraca:catraca@localhost:5432/catraca",
    partnerApiKey: env.PARTNER_API_KEY ?? "catraca-partner-dev-key",
    gatewayMode: "simulated",
    gatewayDelayScale,
  };
}
