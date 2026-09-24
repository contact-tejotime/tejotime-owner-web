/**
 * /queue only redirects to Home (the live board lives there, as on the app — its Queue tab is a
 * redirect too). What flashes during that redirect is therefore Home's skeleton, not a sketch of
 * the old standalone queue page, which no longer exists to be sketched.
 */
export { default } from "../dashboard/loading";
