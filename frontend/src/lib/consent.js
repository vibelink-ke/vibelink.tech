import { readConsent } from '../ui/CookieBanner';

/**
 * Whether the visitor allows optional cookies (analytics and the like). False until they press "Accept all".
 * Anything that sets a non-essential cookie or loads a tracking script must check this first, and re-check on the
 * 'vibelink:consent' event, which fires whenever the choice changes.
 */
export const consentGiven = () => readConsent() === 'all';
