import { pool } from './pool';

/**
 * Call a Postgres function by name with named arguments, e.g.
 *   callRpc('queue_add', { p_business_id: id, p_name: 'Ada' })
 *     → select queue_add(p_business_id => $1, p_name => $2)
 *
 * Named notation (rather than positional) keeps the call sites order-independent,
 * matching how these were invoked before. Errors propagate unchanged so the error
 * middleware can map the TEJO:* codes the functions raise.
 */
export async function callRpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(fn)) throw new Error(`Unsafe function name: ${fn}`);

  const names = Object.keys(args);
  for (const name of names) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe argument name: ${name}`);
  }

  const params = names.map((name) => args[name]);
  const argList = names.map((name, i) => `${name} => $${i + 1}`).join(', ');

  // `select * from fn(...)`, never `select fn(...)`: a `returns table` function in
  // the target list is rendered as one composite-record *string* per row, which
  // silently destroys every admin analytics result.
  const { rows, fields } = await pool.query(`select * from ${fn}(${argList})`, params);

  // A scalar-returning function (the queue_* ones, all `returns jsonb`) yields a
  // single column named after the function — unwrap it to the bare value. Anything
  // else is a `returns table` set, handed back as the row array. This mirrors what
  // PostgREST did, so call sites are unchanged.
  if (fields.length === 1 && fields[0].name === fn.toLowerCase()) {
    return (rows[0]?.[fields[0].name] ?? null) as T;
  }
  return rows as T;
}
