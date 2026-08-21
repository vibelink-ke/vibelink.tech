import React from 'react';
import { color, font, radius } from '../theme/tokens';

/**
 * Keep one broken screen from taking the whole product down.
 *
 * React unmounts the entire tree when a render throws, and there was no
 * boundary anywhere, so any error on any screen left a blank page — no
 * sidebar, no message, nothing to report but "it is black". Diagnosing that
 * meant guessing, because the one fact that identifies the fault was in a
 * console nobody had open.
 *
 * The sidebar and topbar stay up, so the rest of the app is still usable, and
 * the message goes on screen where it can be read out or photographed.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  /**
   * A stale tab, not a broken screen — every Vite build hashes each screen's
   * chunk filename fresh, so a tab left open across a deploy is still holding
   * the old hash. Clicking into that screen fetches a file that no longer
   * exists ("Failed to fetch dynamically imported module") and lands here
   * looking exactly like a real crash, with a stack trace that says nothing
   * about the actual cause: the code was fine, the file just isn't there
   * under that name any more.
   *
   * A single automatic reload fetches the current index.html and the correct
   * current hash, which is the fix every time this is the real cause — so do
   * it once, silently, rather than making someone read a scary-looking error
   * and click Reload themselves for something that was never their bug.
   *
   * Guarded to exactly once per tab: if reloading did not clear the error
   * (session storage still holds the flag on the next mount), this is a real
   * failure — a network problem, a genuinely broken build — and reloading on
   * a loop would just hide that behind an infinite spinner. Falls through to
   * the normal screen below in that case.
   */
  componentDidCatch(error, info) {
    // Still log it: the stack is worth more than the message when someone can
    // open the console, and the message alone is what goes on screen.
    console.error('screen crashed', error, info?.componentStack);

    const stale = /Failed to fetch dynamically imported module|error loading dynamically imported module/i
      .test(String(error?.message ?? ''));
    if (stale && !sessionStorage.getItem('vibelink_stale_reload')) {
      sessionStorage.setItem('vibelink_stale_reload', '1');
      window.location.reload();
    }
  }

  componentDidUpdate(prev) {
    // Any update where nothing is currently erroring means something rendered
    // successfully — clear the once-per-tab reload flag so a *future* stale
    // chunk (the next deploy) gets its own automatic reload rather than being
    // silently left as a stuck error screen because this tab already spent
    // its one attempt on a previous, unrelated deploy.
    if (!this.state.error) sessionStorage.removeItem('vibelink_stale_reload');

    // Navigating away must clear the error, or the boundary keeps showing the
    // old failure over a screen that would have rendered perfectly well.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          border: `1px solid ${color.line}`,
          borderRadius: radius.md,
          background: '#fff',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <strong style={{ fontSize: 15 }}>This screen could not be drawn</strong>
        <p style={{ margin: 0, fontSize: 13.5, color: color.neutralInk, maxWidth: 620 }}>
          Something in the data on this page is not the shape the screen expects.
          The rest of the app still works — the menu on the left will take you
          anywhere else. Sending this message to support identifies the fault
          exactly.
        </p>
        <code
          style={{
            fontFamily: font.mono, fontSize: 12.5, color: color.rust,
            background: color.tileBg, border: `1px solid ${color.line}`,
            borderRadius: radius.sm, padding: '8px 11px', maxWidth: '100%',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {String(error?.message ?? error)}
        </code>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            padding: '8px 14px', borderRadius: radius.sm, border: 'none',
            background: color.green, color: '#fff',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
