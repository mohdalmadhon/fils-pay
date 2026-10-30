/**
 * Pixel art for the Halloween costume. Each sprite is a grid of characters,
 * one per pixel; PixelArt draws it as an SVG of crisp squares (adjacent
 * pixels of one colour are merged into one rect), so it stays sharp at any
 * size. The grids were generated from simple shapes with an automatic
 * one-pixel outline, then kept here as data.
 */
import { memo } from "react";

/** Colour for each character in a sprite grid ("." is transparent). */
export const PIXEL_PALETTE: Readonly<Record<string, string>> = {
  k: "#05030a", // outline
  o: "#ff7a1a", // pumpkin
  O: "#ffa24c", // pumpkin highlight
  d: "#c2410c", // pumpkin rib
  y: "#ffd23f", // candle glow, moon
  Y: "#e0a91c", // moon shade and craters
  D: "#3a1d05", // unlit pumpkin face
  G: "#8fe36b", // stem
  g: "#3f8f2a", // witch's face
  b: "#120a1c", // bat and spider bodies
  r: "#ff5c6c", // eyes
  p: "#b45cf0", // purple outline, witch hat band
  P: "#6b4a9a", // ghost outline
  w: "#f7efe0", // ghost, cobweb
  s: "#c9b8e6", // ghost shade, stone
  S: "#75669a", // stone shade
  c: "#ff9fb0", // ghost blush
};

export const SPRITES = {
  pumpkinLit: [
    "..........k.......",
    ".........kGk......",
    "........kGk.......",
    ".......kGGk.......",
    "....kkkoddokkk....",
    "...kdoooddooodk...",
    "..kOdoooddooodok..",
    ".kOOdyooddooydook.",
    ".kOOyyyoddoyyyook.",
    "kooodoooddooodoook",
    "kooodoooyyooodoook",
    ".koodoooddooodook.",
    ".kooyyoyyyyoyyook.",
    "..kodyyyooyyydok..",
    "...kdoooddooodk...",
    "....kkkoddokkk....",
  ],
  pumpkinDark: [
    "..........k.......",
    ".........kGk......",
    "........kGk.......",
    ".......kGGk.......",
    "....kkkoddokkk....",
    "...kdoooddooodk...",
    "..kOdoooddooodok..",
    ".kOOdDooddooDdook.",
    ".kOODDDoddoDDDook.",
    "kooodoooddooodoook",
    "kooodoooDDooodoook",
    ".koodoooddooodook.",
    ".kooDDoDDDDoDDook.",
    "..kodDDDooDDDdok..",
    "...kdoooddooodk...",
    "....kkkoddokkk....",
  ],
  batUp: [
    ".ppbpp.pbppbp.ppbpp.",
    "pbbpbbppbbbbppbbpbbp",
    ".pbbbbbbprrpbbbbbbp.",
    "..pbbbbbbbbbbbbbbp..",
    "...pppbbpbbpbbppp...",
    "......pppbbppp......",
    "........pbbp........",
    ".........pp.........",
    "....................",
    "....................",
  ],
  batDown: [
    ".......pbppbp.......",
    ".......pbbbbp.......",
    "........prrp........",
    "......pppbbppp......",
    "....ppbbbbbbbbpp....",
    "...pbbbbbbbbbbbbp...",
    "..pbbbbbpbbpbbbbbp..",
    ".pbbbbpp.pp.ppbbbbp.",
    "pbbppp........pppbbp",
    ".pp..............pp.",
  ],
  ghostA: [
    "................",
    ".....PPPPPP.....",
    "....PwwwwwwP....",
    "...PwwwwwwwwP...",
    "..PwwwwwwwwwsP..",
    ".PwwwwwwwwwwssP.",
    ".PwwwkkwwkkwssP.",
    ".PwwwkkwwkkwssP.",
    ".PwwwkwwwkwwssP.",
    ".PwwwwwwwwwwssP.",
    ".PwwcwwwwwwcssP.",
    ".PwwwwwkkwwwssP.",
    ".PwwwwwkkwwwssP.",
    ".PwwwwwwwwwwssP.",
    ".PwwwwwwwwwwssP.",
    ".PwwwwwwwwwwssP.",
    "..PPwwPPwwPPwwP.",
    "....PP..PP..PP..",
  ],
  ghostB: [
    "................",
    ".....PPPPPP.....",
    "....PwwwwwwP....",
    "...PwwwwwwwwP...",
    "..PwwwwwwwwwsP..",
    ".PwwwwwwwwwwssP.",
    ".PwwwkkwwkkwssP.",
    ".PwwwkkwwkkwssP.",
    ".PwwwkwwwkwwssP.",
    ".PwwwwwwwwwwssP.",
    ".PwwcwwwwwwcssP.",
    ".PwwwwwkkwwwssP.",
    ".PwwwwwkkwwwssP.",
    ".PwwwwwwwwwwssP.",
    ".PwwwwwwwwwwssP.",
    ".PwwwwwwwwwwssP.",
    "..PwwPPwwPPwwP..",
    "...PP..PP..PP...",
  ],
  spider: [
    "......ppp......",
    ".....pbbbp.....",
    "..p..prbrp..p..",
    ".pbp.ppppp.pbp.",
    "pbpbpbbbbbpbpbp",
    "bppppbbbbbppppb",
    "ppbbbbbobbbbbpp",
    "pbppbbbobbbppbp",
    "bppbpbbbbbpbppb",
    "ppbpbbbbbbbpbpp",
    "pbpbpppppppbpbp",
    ".pbp.......pbp.",
  ],
  moon: [
    "..................",
    ".....yyyyyyyy.....",
    "....yyyyyyyyyy....",
    "...yyyyyyyyyyyy...",
    "..yyyyyyyyYyyyyY..",
    ".yyyyyyyyyyyyyyYY.",
    ".yyyyYyyyyyyyyyyY.",
    ".yyyyyyyyyyyyyyyY.",
    ".yyyyyyyyyyyyyyyY.",
    ".yyyyyyyyyYYYyyyY.",
    ".yyyyyyyyyYYYyyyY.",
    ".yyyyyYyyyYYYyyyY.",
    ".yyyyYYYyyyyyyyYY.",
    "..yyyyYyyyyyyyyY..",
    "...yyyyyyyyyyyY...",
    "....YYyyyyyyYY....",
    ".....YYYYYYYY.....",
    "..................",
  ],
  cobweb: [
    "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
    "wwwww.w......w.......w........w.....",
    "wwww.www....w.......w.......ww......",
    "www.w.w.wwww.w.....w.......w........",
    "ww.wwww.....www.....w.....w.........",
    "w.w.w.ww...ww..www..w......w........",
    "wwwwww..w..w......wwww.....w........",
    "w.w..w...w.w.........www....w.......",
    "w..w..w.wwww.......ww...www.w.......",
    "w..w...ww...w....ww........wwww.....",
    "w..w....w....w...w..........ww.www..",
    "w..w.wwww.....ww..w.......ww......ww",
    "w.www....w......w.w.....ww..........",
    "ww..w.....w......ww.....w...........",
    "w...w......w..www.ww....w...........",
    "w....w.....w..w.....w....w..........",
    "w....w......ww.......w...w..........",
    "w....w...www.w........ww.w..........",
    "w.....w.w...www........www..........",
    "w..ww.w.w.....w....wwww..w..........",
    "w.w..www.......w...w......ww........",
    "ww.....w........w..w........w.......",
    "w......w.........ww..........w......",
    "w......w.........ww...........ww....",
    "w.......w...wwww..w.............w...",
    "w.......w...w...wwww................",
    "w...ww..w..w........w...............",
    "w..w..ww.w.w........w...............",
    "w.w.....www..........w..............",
    "w.w......ww...........w.............",
    "ww.......w.............w............",
    "w.........w............w............",
    "w.........w.............w...........",
    "w.........w.........................",
    "w..........w........................",
    "w..........w........................",
  ],
  witch: [
    "............P...............",
    "...........PkP..............",
    "..........PkkP..............",
    ".........PkpkP..............",
    "........PkppkP..............",
    ".......PkkkkkkP.............",
    "......PkkkkkkkkP............",
    ".......PPgkkPPP.............",
    ".....PPppkkkkkP.............",
    ".PPPPpppkkkkkkkPPPPPPPPPP...",
    "POOOdddpdddddddddddddddddP..",
    "POOOOddddkkkkddddddddddPP...",
    "POOOPPPPPPkkPPkPPPPPPPP.....",
    ".PPP....PkkP.PkkP...........",
    ".........PP...PP............",
  ],
  tombRound: [
    "..kkkkkk..",
    ".kssssssk.",
    "kssssssssk",
    "kskkkkkksk",
    "kssssssssk",
    "ksskkkkssk",
    "ksssssssSk",
    "ksssssssSk",
    "ksssssssSk",
    "kkkkkkkkkk",
  ],
  tombCross: [
    "...kkk...",
    "...ksk...",
    "kkkkskkkk",
    "ksssssssk",
    "kkkkskkkk",
    "...ksk...",
    "...ksk...",
    "...ksk...",
    "..kkkkk..",
  ],
} as const satisfies Record<string, readonly string[]>;

export type SpriteName = keyof typeof SPRITES;

interface Run {
  x: number;
  y: number;
  w: number;
  c: string;
}

function runsOf(rows: readonly string[], palette: Readonly<Record<string, string>>): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === ch) end += 1;
      if (ch !== "." && palette[ch]) runs.push({ x, y, w: end - x, c: palette[ch]! });
      x = end;
    }
  });
  return runs;
}

/**
 * One sprite as an SVG. Size it with CSS (width/height); the viewBox keeps
 * every pixel square. `palette` overrides colours (the pumpkin button uses
 * it to follow the page's ink colour when unlit).
 */
export const PixelArt = memo(function PixelArt({
  sprite,
  className,
  palette,
}: {
  sprite: SpriteName;
  className?: string;
  palette?: Readonly<Record<string, string>>;
}) {
  const rows = SPRITES[sprite];
  const runs = runsOf(rows, palette ? { ...PIXEL_PALETTE, ...palette } : PIXEL_PALETTE);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${rows[0]!.length} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden
      focusable={false}
    >
      {runs.map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  );
});
