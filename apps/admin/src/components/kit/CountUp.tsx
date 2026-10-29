/** Numbers that roll up to their value when they appear or change. */
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion.js";

export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target);
  const from = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(origin + (target - origin) * eased);
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, duration]);

  return value;
}
