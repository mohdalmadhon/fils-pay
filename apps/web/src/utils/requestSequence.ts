import { useRef } from "react";

/**
 * Drops stale responses on list pages. Every call to `begin()` starts a new
 * request and returns a check that stays true only while no later request
 * has begun. A page calls `begin()` at the top of each fetch and ignores the
 * response (data, error and loading flag) once the check is false, so a slow
 * answer for an old filter, or a "Load more" page from an old filter, can
 * never land on screen after a newer request was started.
 */
export interface RequestSequence {
  begin(): () => boolean;
}

export function createRequestSequence(): RequestSequence {
  let latest = 0;
  return {
    begin() {
      const id = ++latest;
      return () => id === latest;
    },
  };
}

/** One sequence per mounted component. */
export function useRequestSequence(): RequestSequence {
  const ref = useRef<RequestSequence | null>(null);
  if (!ref.current) ref.current = createRequestSequence();
  return ref.current;
}
