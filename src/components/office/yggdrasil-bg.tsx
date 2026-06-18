// Decorative world-tree backdrop for the office scene. Pure SVG, sits behind
// the content at low opacity. No interactivity.

export function YggdrasilBg() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-60 pointer-events-none"
      viewBox="0 0 1200 820"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="yggStroke" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#2a2016" />
          <stop offset="45%" stopColor="#3fae73" />
          <stop offset="100%" stopColor="#e3bd6a" />
        </linearGradient>
        <radialGradient id="leafGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3fae73" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#3fae73" stopOpacity="0" />
        </radialGradient>
        <filter id="yggBlur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* roots flaring into the ground */}
      <g className="ygg-branch" strokeWidth="6" filter="url(#yggBlur)" opacity="0.8">
        <path d="M600 780 C 520 800 430 800 300 815" />
        <path d="M600 780 C 680 800 770 800 900 815" />
        <path d="M600 770 C 540 800 470 805 360 820" />
        <path d="M600 770 C 660 800 730 805 840 820" />
      </g>

      {/* trunk */}
      <path className="ygg-branch" strokeWidth="16" d="M600 800 C 588 620 612 520 600 380" filter="url(#yggBlur)" />

      {/* primary + secondary branches */}
      <g className="ygg-branch" filter="url(#yggBlur)">
        <path strokeWidth="9" d="M600 420 C 470 360 360 300 250 240" />
        <path strokeWidth="9" d="M600 420 C 730 360 840 300 950 240" />
        <path strokeWidth="6" d="M600 470 C 510 440 430 410 330 360" />
        <path strokeWidth="6" d="M600 470 C 690 440 770 410 870 360" />
        <path strokeWidth="5" d="M600 390 C 560 320 560 260 600 180" />
        <path strokeWidth="4" d="M300 250 C 250 210 220 180 180 150" />
        <path strokeWidth="4" d="M900 250 C 950 210 980 180 1020 150" />
      </g>

      {/* canopy leaf-glow clusters */}
      <g className="leaf-sway">
        <circle cx="600" cy="160" r="120" fill="url(#leafGlow)" />
        <circle cx="240" cy="220" r="95" fill="url(#leafGlow)" />
        <circle cx="960" cy="220" r="95" fill="url(#leafGlow)" />
        <circle cx="400" cy="170" r="70" fill="url(#leafGlow)" />
        <circle cx="800" cy="170" r="70" fill="url(#leafGlow)" />
      </g>
    </svg>
  );
}
