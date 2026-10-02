import { useLayoutEffect, useRef, useState } from 'react';

/**
 * For things drawn on <body> (a toast, a banner) that still need to look like part of a dark page.
 *
 * Dark mode is a CSS filter on the page's root element, and a filtered ancestor turns position: fixed into
 * "fixed to the whole page" rather than "fixed to the screen" — so these are rendered on <body> instead. That
 * takes them out from under the filter, so they have to carry it themselves, but only when the place they were
 * rendered from really is inside the dark page (the field app, for one, is not). Put the returned ref on a
 * hidden marker element where the component sits in the tree, and give the portalled element `om-dark` when
 * `dark` is true.
 */
export function useInDark() {
  const ref = useRef(null);
  const [dark, setDark] = useState(false);
  useLayoutEffect(() => {
    const inside = !!ref.current?.closest('.om-dark');
    setDark((d) => (d === inside ? d : inside));
  });
  return [ref, dark];
}
