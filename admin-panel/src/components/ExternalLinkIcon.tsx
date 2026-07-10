/** External-link glyph (rounded box with an arrow leaving the top-right). Inherits text color. */
export default function ExternalLinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ verticalAlign: "-0.125em" }}
    >
      <path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
      <path d="M14 3h7v7" />
      <path d="M10.5 13.5 21 3" />
    </svg>
  );
}
