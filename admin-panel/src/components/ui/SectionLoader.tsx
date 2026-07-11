import Spinner from "./Spinner";

/** Inline block loader for an async region inside a card/section (e.g. a drawer or
 *  profile panel that fetches on demand). */
export default function SectionLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="section-loader">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
