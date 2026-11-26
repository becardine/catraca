import pg from "pg";

export type Pool = pg.Pool;
/** A pool or a client inside a transaction; both can run queries. */
export type Db = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 20 });
}
