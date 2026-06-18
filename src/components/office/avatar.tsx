"use client";

import { useState } from "react";

// Portrait avatar for an agent. Resolution order:
//  1) a real image you drop at public/agents/<codename>.png  (your generated art)
//  2) a generated character portrait from DiceBear (unique per codename, free)
//  3) the emoji, if offline / both fail
// "adventurer" = RPG faces (roster/modal); "pixel-art" = 8-bit sprites (iso office).
export function Avatar({ codename, emoji, variant = "adventurer" }: { codename: string; emoji: string; variant?: "adventurer" | "pixel-art" }) {
  const local = `/agents/${codename.toLowerCase()}.png`;
  const generated = `https://api.dicebear.com/9.x/${variant}/svg?seed=${encodeURIComponent(codename)}`;
  const [src, setSrc] = useState(local);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className="grid place-items-center w-full h-full text-xl">{emoji}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={codename}
      loading="lazy"
      className={"w-full h-full object-cover" + (variant === "pixel-art" ? " pixelated" : "")}
      onError={() => (src === local ? setSrc(generated) : setFailed(true))}
    />
  );
}
