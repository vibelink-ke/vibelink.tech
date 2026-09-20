import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { checkPassword, generatePassword } from '../lib/password';

const GOOD = '#0f7a5f';

/**
 * Shown under a "new password" field: which rules the password meets so far,
 * and a button that fills in a strong one. The password fields hide what is
 * typed, so a suggestion is also shown here — with Copy — because a password
 * nobody has seen is one nobody can write down.
 *
 * onSuggest(password) should set every password field on the form (the
 * confirm box too), so the two cannot disagree.
 */
export default function PasswordHelper({ value, onSuggest }) {
  const [suggested, setSuggested] = useState('');
  const [copied, setCopied] = useState(false);
  const { rules } = checkPassword(value);

  const suggest = () => {
    const p = generatePassword(12);
    setSuggested(p);
    setCopied(false);
    onSuggest(p);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(suggested);
      setCopied(true);
    } catch {
      /* clipboard blocked — the password is on screen to copy by hand */
    }
  };

  // The suggestion box disappears as soon as the field no longer holds it.
  const showSuggestion = suggested && value === suggested;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
        {rules.map((r) => (
          <li key={r.key} style={{ fontSize: 12, color: r.ok ? GOOD : color.muted, display: 'flex', gap: 6 }}>
            <span aria-hidden style={{ width: 12 }}>{r.ok ? '✓' : '○'}</span>
            {r.label}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={suggest}
        style={{
          alignSelf: 'flex-start', border: `1px solid ${color.line}`, background: 'transparent',
          borderRadius: radius.sm, padding: '6px 12px', fontSize: 12.5, fontWeight: 600,
          color: color.green, cursor: 'pointer',
        }}
      >
        Suggest a strong password
      </button>

      {showSuggestion && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px',
          background: color.tileBg, borderRadius: radius.sm,
        }}>
          <code style={{ fontFamily: font.mono, fontSize: 14, letterSpacing: '.04em', color: color.ink, userSelect: 'all' }}>
            {suggested}
          </code>
          <button
            type="button"
            onClick={copy}
            style={{
              border: 0, background: 'transparent', color: color.green, fontSize: 12.5, fontWeight: 600,
              cursor: 'pointer', padding: 0,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span style={{ fontSize: 11.5, color: color.muted, flexBasis: '100%' }}>
            Filled in for you. Save it somewhere safe before you continue.
          </span>
        </div>
      )}
    </div>
  );
}
