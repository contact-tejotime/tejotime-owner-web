/**
 * The admin session cookie name, isolated in its own module (no `node:crypto`
 * import) so the Edge-runtime middleware can import it without pulling in Node
 * crypto — which only session.ts (Node runtime) needs.
 */
export const SESSION_COOKIE = "tt_admin_session";
