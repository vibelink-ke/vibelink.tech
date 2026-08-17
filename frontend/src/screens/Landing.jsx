import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';

/**
 * The public face of the platform, shown on the root domain only.
 *
 * The root domain belongs to no tenant, so there is nothing here to sign into:
 * an ISP registers, and every day after that they use their own subdomain.
 * Keeping the two apart is what stops an operator landing on vibelink.tech and
 * wondering why their customers are missing.
 *
 * Deliberately plain markup and inline styles, matching the rest of the app.
 * This page is read once by each visitor and needs no framework of its own.
 */

const FEATURES = [
  ['M-Pesa that reconciles itself',
   'Paybill, till and STK push. Payments match to the account number the customer typed, and the ones that do not are put in front of you rather than lost.'],
  ['MikroTik without the console',
   'Point a router at us over a tunnel — no public IP, no port forwarding. RADIUS, PPPoE, hotspot, DHCP and the firewall rules are pushed for you.'],
  ['Hotspot that sells',
   'A captive portal with your name on it. Guests buy a bundle with M-Pesa and get a code by SMS, without an account and without leaving the page.'],
  ['Speed changes that land now',
   'Change a plan and the session changes with it. No waiting for the customer to reconnect, no ringing them to ask.'],
  ['Fair use that enforces itself',
   'Set the cap and the throttle. It applies quietly and lifts when the window rolls over.'],
  ['Answers when something breaks',
   'Which tower is down, who is online, what each port is carrying, and where every customer lives on a map.'],
];

const STEPS = [
  ['Register', 'Pick your name and your subdomain. Takes a minute.'],
  ['Add a router', 'Paste one line into your MikroTik. It dials in on its own.'],
  ['Add customers', 'Or import the PPPoE accounts already on the router.'],
  ['Get paid', 'Connect M-Pesa and let the reconciliation run.'],
];

const Section = ({ children, style }) => (
  <section style={{ maxWidth: 1080, margin: '0 auto', padding: '0 22px', ...style }}>
    {children}
  </section>
);

export default function Landing({ onRegister }) {
  return (
    <div style={{
      minHeight: '100vh', background: color.pageBg, color: color.ink,
      fontFamily: font.sans, fontSize: 15, lineHeight: 1.55,
    }}>
      <header style={{ borderBottom: `1px solid ${color.line}`, background: color.cardBg }}>
        <Section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 62, padding: '0 22px',
        }}>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-.01em' }}>Vibelink</span>
          {/* No sign-in here. This domain is the website, not the product:
              nobody's customers live on it, and every ISP works on their own
              subdomain. A sign-in button invites people to try signing in
              somewhere that cannot authenticate them. */}
          <button type="button" onClick={onRegister} style={solid}>Register</button>
        </Section>
      </header>

      <Section style={{ padding: '64px 22px 46px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 40, lineHeight: 1.12, margin: '0 0 14px', letterSpacing: '-.02em' }}>
          Billing for Kenyan ISPs,<br />without the spreadsheet
        </h1>
        <p style={{ fontSize: 17, color: color.inkSoft, maxWidth: 640, margin: '0 auto 26px' }}>
          Run PPPoE and hotspot customers on your MikroTik, take M-Pesa, and stop
          reconciling payments by hand. Your own portal on your own subdomain.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={onRegister} style={{ ...solid, padding: '12px 24px', fontSize: 15 }}>
            Start free
          </button>
        </div>
        <p style={{ fontSize: 13, color: color.muted, marginTop: 12 }}>
          No card. Your subdomain is live as soon as you register.
        </p>
      </Section>

      <Section style={{ padding: '10px 22px 56px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14,
        }}>
          {FEATURES.map(([title, body]) => (
            <div key={title} style={{
              background: color.cardBg, border: `1px solid ${color.line}`,
              borderRadius: radius.lg ?? 12, padding: '18px 18px 20px',
            }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 15.5 }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: color.inkSoft }}>{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <div style={{ background: color.cardBg, borderTop: `1px solid ${color.line}`, borderBottom: `1px solid ${color.line}` }}>
        <Section style={{ padding: '46px 22px' }}>
          <h2 style={{ fontSize: 24, margin: '0 0 22px', textAlign: 'center' }}>Getting started</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {STEPS.map(([title, body], i) => (
              <div key={title}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', background: color.green, color: '#fff',
                  display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, marginBottom: 8,
                }}>{i + 1}</div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 13.5, color: color.inkSoft }}>{body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section style={{ padding: '52px 22px 64px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, margin: '0 0 10px' }}>Ready when you are</h2>
        <p style={{ color: color.inkSoft, maxWidth: 520, margin: '0 auto 20px' }}>
          Register, add one router, and see your own customers on your own portal.
        </p>
        <button type="button" onClick={onRegister} style={{ ...solid, padding: '12px 24px', fontSize: 15 }}>
          Create your account
        </button>
      </Section>

      <footer style={{ borderTop: `1px solid ${color.line}`, background: color.cardBg }}>
        <Section style={{
          padding: '20px 22px', display: 'flex', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 10, fontSize: 13, color: color.muted,
        }}>
          <span>© {new Date().getFullYear()} Vibelink</span>
          <span>Nairobi, Kenya · support@vibelink.tech</span>
        </Section>
      </footer>
    </div>
  );
}

const solid = {
  background: color.green, color: '#fff', border: 0, borderRadius: 9,
  padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const ghost = {
  background: 'transparent', color: color.ink, border: `1px solid ${color.line}`,
  borderRadius: 9, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
