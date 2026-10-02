/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Page background — soft mint, per the approved lime-green theme
        // (kept the "cream" key so every existing bg-cream/text-on-cream
        // usage across the app just picks up the new value automatically).
        cream: '#ccf5d0',
        ink: '#24291f',
        muted: '#6b7062',
        // Lime Green brand scale. 500 = Primary (Lime Green #84CC16), 600 =
        // Primary Dark / hover-active (#65A30D). 700 is a darker,
        // WCAG-safe shade for text/links on a light background — Lime
        // Green itself is too light to use as body/link text. 50/100 are
        // light tints (badges, active-nav backgrounds), 400 a lighter accent.
        brand: {
          50: '#f7fee7',
          100: '#ecfccb',
          400: '#a3e635',
          500: '#84cc16',
          600: '#65a30d',
          700: '#3f6212',
        },
        // Sidebar header/footer strip — Golden Tan, distinct from the lime
        // nav body. `tan-ink`/`tan-ink-muted` are the two text shades used
        // on top of it (soft dark brown, not pure black).
        tan: {
          DEFAULT: '#d9a66c',
          ink: '#3b2a18',
          'ink-muted': '#6b4f32',
        },
        // Inactive nav-item text/icon color on the lime sidebar body
        // (transparent by default; hover/active switches to white).
        sidebar: {
          inactive: '#14532d',
        },
      },
    },
  },
  plugins: [],
};
