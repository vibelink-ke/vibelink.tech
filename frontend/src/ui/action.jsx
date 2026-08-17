import React, { useCallback, useState } from 'react';
import { color, radius } from '../theme/tokens';
import { Button, Modal } from './primitives';

/**
 * Say what a slow action is doing, and what it did.
 *
 * Most actions here finish instantly and a toast is right for them. A few do
 * not: sending to four hundred handsets, reconciling a pasted statement,
 * importing a CSV, registering callback URLs with Safaricom. Those take seconds
 * against somebody else's server, and a toast that appears when they finish
 * leaves the operator pressing the button again halfway through — which for a
 * bulk SMS means paying twice.
 *
 * The dialog stays until dismissed. "It worked" and "nothing happened" look
 * identical when the only feedback disappears after four seconds.
 *
 * Routers grew its own version of this while chasing router pushes; this is
 * that idea made reusable, and the shape is deliberately the same so the two
 * feel like one thing.
 */
export function useAction() {
  const [state, setState] = useState(null); // { title, phase, detail, lines, error }

  /**
   * Run `fn`, showing progress while it goes.
   *
   * `describe` turns the result into something worth reading. Without it the
   * dialog can only say "done", which is barely better than the toast it
   * replaced — the useful part is "sent to 412, 3 failed".
   */
  const run = useCallback(async (title, fn, { describe, working = 'Working…' } = {}) => {
    setState({ title, phase: 'running', detail: working });
    try {
      const result = await fn();
      const said = describe ? describe(result) : null;
      setState({
        title,
        phase: 'done',
        detail: typeof said === 'string' ? said : 'Finished.',
        lines: Array.isArray(said) ? said : (said?.lines ?? null),
      });
      return result;
    } catch (e) {
      // The error is shown rather than summarised: the message from the server
      // is usually the only thing that says what to do differently.
      setState({ title, phase: 'failed', error: e.message });
      throw e;
    }
  }, []);

  const dismiss = useCallback(() => setState(null), []);
  return { state, run, dismiss };
}

const TONE = {
  running: { fg: color.inkSoft, bg: color.tileBg, border: color.line },
  done: { fg: color.green, bg: '#e8f3ee', border: '#b9dccd' },
  failed: { fg: color.rust, bg: '#fdece5', border: '#f3c7b6' },
};

export function ActionResult({ state, onClose }) {
  if (!state) return null;
  const tone = TONE[state.phase];
  const busy = state.phase === 'running';

  return (
    <Modal
      open
      title={state.title}
      // Closing mid-flight would hide something still happening; the action
      // carries on regardless and the operator loses the only report of it.
      onClose={busy ? () => {} : onClose}
      footer={<Button onClick={onClose} disabled={busy}>{busy ? 'Please wait…' : 'Close'}</Button>}
    >
      <div style={{
        display: 'grid', gap: 8, fontSize: 13.5,
        color: tone.fg, background: tone.bg,
        border: `1px solid ${tone.border}`, borderRadius: radius.md, padding: '11px 13px',
      }}>
        <span>{state.phase === 'failed' ? state.error : state.detail}</span>
        {state.lines?.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3 }}>
            {state.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
