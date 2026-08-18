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

  componentDidCatch(error, info) {
    // Still log it: the stack is worth more than the message when someone can
    // open the console, and the message alone is what goes on screen.
    console.error('screen crashed', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
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
