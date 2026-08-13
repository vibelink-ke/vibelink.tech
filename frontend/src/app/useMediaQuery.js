import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from React.
 *
 * The layout has to branch in JavaScript rather than CSS because the sidebar
 * changes structurally on a phone — fixed instead of sticky, over the content
 * instead of beside it — and those are decisions the component makes, not styles
 * it applies.
 *
 * Seeded from the real match rather than a default, so a phone never renders one
 * frame of desktop layout before correcting itself.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false)
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);   // in case it changed between render and effect
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
