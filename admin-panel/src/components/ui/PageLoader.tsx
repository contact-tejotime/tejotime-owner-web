import Spinner from "./Spinner";

/** Full-pane centered loader (spinner + label). For client-side fallbacks where a
 *  tailored skeleton isn't warranted. Route segments use skeleton loading.tsx instead. */
export default function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
