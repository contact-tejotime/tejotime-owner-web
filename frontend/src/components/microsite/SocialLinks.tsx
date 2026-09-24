/**
 * The store's social profiles, as icon links.
 *
 * Brand marks, not stroke icons — these are recognised by their exact silhouette, so the usual
 * "draw it in the house line style" instinct is wrong here. They are filled paths on the
 * surrounding text colour rather than each brand's own colour, which keeps a row of four from
 * shouting over the store's own palette on a page that is otherwise entirely theme-driven.
 *
 * The API filters out the ones the store left blank, so this renders nothing at all for a shop
 * with no social presence rather than four dead icons.
 */

type SocialKey = "instagram" | "facebook" | "twitter" | "linkedin" | "yelp";

/** Simple Icons paths, 24×24, filled. */
const MARKS: Record<SocialKey, { label: string; path: string }> = {
  instagram: {
    label: "Instagram",
    path: "M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.13 1.38C1.35 2.68.93 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13.67.66 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.3 1.46-.72 2.13-1.38.66-.67 1.08-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.3-.79-.72-1.46-1.38-2.13C21.32 1.35 20.65.93 19.86.63 19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z",
  },
  facebook: {
    label: "Facebook",
    path: "M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z",
  },
  twitter: {
    label: "X",
    path: "M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z",
  },
  linkedin: {
    label: "LinkedIn",
    path: "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z",
  },
  // The five-petal burst is drawn as geometry (five rounded wedges around the centre), not traced
  // from a found path — a copied "yelp icon" SVG rendered with a malformed top-left petal and a
  // stray sliver when checked against the real logo (rendered and eyeballed with sharp before
  // this was kept). Matches the logo's slight counter-clockwise tilt.
  yelp: {
    label: "Yelp",
    path: "M11.805 8.838Q11.71 10.836 10.687 9.117L7.495 3.748Q6.473 2.029 8.414 1.545L10.258 1.086Q12.199 0.602 12.103 2.599ZM15.677 10.663Q13.696 10.94 14.814 9.282L16.735 6.431Q17.853 4.773 18.913 6.469L20.002 8.212Q21.062 9.908 19.081 10.186ZM14.408 15.084Q13.532 13.286 15.455 13.836L18.76 14.782Q20.682 15.333 19.397 16.865L18.075 18.44Q16.79 19.972 15.914 18.174ZM9.812 15.243Q11.251 13.854 11.321 15.853L11.443 19.289Q11.513 21.287 9.659 20.538L7.753 19.768Q5.899 19.019 7.338 17.63ZM8.239 10.921Q10.005 11.86 8.126 12.545L4.896 13.722Q3.017 14.407 3.156 12.412L3.3 10.361Q3.439 8.366 5.205 9.306Z",
  },
};

export function SocialLinks({
  socials,
  size = 18,
}: {
  socials: { key: string; url: string }[] | undefined;
  size?: number;
}) {
  const items = (socials ?? []).filter((s): s is { key: SocialKey; url: string } => s.key in MARKS);
  if (items.length === 0) return null;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
      {items.map(({ key, url }) => (
        <a
          key={key}
          href={url}
          target="_blank"
          // noopener is the load-bearing half — without it the opened page can reach back
          // through window.opener. noreferrer is for the store's own privacy.
          rel="noopener noreferrer"
          aria-label={MARKS[key].label}
          title={MARKS[key].label}
          style={{
            display: "inline-flex",
            color: "var(--text-muted)",
            transition: "color .15s ease, transform .15s ease",
          }}
          className="ttSocialLink"
        >
          <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d={MARKS[key].path} />
          </svg>
        </a>
      ))}
    </div>
  );
}
