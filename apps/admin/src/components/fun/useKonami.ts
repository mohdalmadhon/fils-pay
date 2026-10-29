/** The Konami code (up up down down left right left right B A) fires once
 *  per entry. FilsPay's reward: it rains coins. */
import { useEffect, useRef } from "react";

const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function useKonami(onCode: () => void): void {
  const handler = useRef(onCode);
  handler.current = onCode;
  useEffect(() => {
    let at = 0;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      at = key === CODE[at] ? at + 1 : key === CODE[0] ? 1 : 0;
      if (at === CODE.length) {
        at = 0;
        handler.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
