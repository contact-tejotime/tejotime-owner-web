# TejoTime-Web

The web app for TejoTime — the digital OS for appointment-based small businesses.

Built with [Next.js 16](https://nextjs.org) (App Router), React 19, TypeScript and
Tailwind CSS v4. Shares the TejoTime design tokens with `TejoTime-Main`.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command         | Description                       |
| --------------- | --------------------------------- |
| `npm run dev`   | Start the dev server              |
| `npm run build` | Production build                  |
| `npm run start` | Serve the production build        |
| `npm run lint`  | Lint with ESLint / Next.js config |

## Structure

```
src/
  app/
    layout.tsx     # Root layout, fonts, metadata
    page.tsx       # Landing page
    globals.css    # Design tokens + base styles
```
