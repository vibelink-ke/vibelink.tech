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

// The phone number was removed at the owner's request. Email carries the same
// "talk to a person" intent without publishing a number that rings one handset.
const SALES_EMAIL = 'sales@vibelink.co.ke';
const SUPPORT_EMAIL = 'support@vibelink.co.ke';

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
  ['No paybill yet? We collect for you',
   'Turn on collection and your customers pay into our paybill from day one, PPPoE or hotspot — we pay you out nightly, net of a small commission, straight to your own M-Pesa number.'],
  ['Every router accounted for',
   'Track gadgets by MAC and serial, issue one to a technician and it comes off the shelf automatically, mark a faulty unit and swap it in one step, and know at a glance whether the customer paid for it or it is still yours.'],
  ['A team, not a shared password',
   'Invite cashiers, technicians and support staff by phone or email — they pick their own username and password. Roles are enforced, not just labelled, and only an owner can ever remove another owner.'],
];

/**
 * What Vibelink sells besides the software.
 *
 * An ISP evaluating a billing system is also deciding who to buy capacity
 * from, and they are the same conversation. Kept separate from the software
 * features so neither reads as filler for the other.
 */
const SERVICES = [
  ['FTTH — homes',
   'Fibre to the home for estates and residential clusters. We build the '
   + 'distribution, you sell the packages and keep the customer.'],
  ['FTTB — buildings and business',
   'Fibre to apartment blocks, offices and business parks, with the capacity '
   + 'and the SLA a paying tenant expects.'],
  ['Bulk internet for ISPs',
   'Wholesale bandwidth and IP transit by the megabit, on your own capacity '
   + 'plan. Burst when your evening peak needs it rather than paying for peak '
   + 'all month.'],
];

const STEPS = [
  ['Register', 'Pick your name and your subdomain. Takes a minute.'],
  ['Add a router', 'Paste one line into your MikroTik. It dials in on its own.'],
  ['Add customers', 'Or import the PPPoE accounts already on the router.'],
  ['Get paid', 'Connect M-Pesa and let the reconciliation run.'],
];

const Section = ({ children, style }) => (
  <section style={{ maxWidth: 1440, margin: '0 auto', padding: '0 32px', ...style }}>
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* An ISP buying capacity is making a relationship decision, not a
                checkout one, so there is a way to reach a person here. */}
            <a href={`mailto:${SALES_EMAIL}`} style={{ ...ghost, textDecoration: 'none' }}>
              Talk to sales
            </a>
            <button type="button" onClick={onRegister} style={solid}>Register</button>
          </div>
        </Section>
      </header>

      <Section style={{ padding: '64px 22px 46px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 40, lineHeight: 1.12, margin: '0 0 14px', letterSpacing: '-.02em' }}>
          Billing, fibre and bandwidth<br />for Kenyan ISPs
        </h1>
        <p style={{ fontSize: 17, color: color.inkSoft, maxWidth: 640, margin: '0 auto 26px' }}>
          Run PPPoE and hotspot customers on your MikroTik, take M-Pesa, and stop
          reconciling payments by hand — and buy your FTTH, FTTB and bulk capacity
          from the same people. Your own portal on your own subdomain.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={onRegister} style={{ ...solid, padding: '12px 24px', fontSize: 15 }}>
            Start free
          </button>
          <a href={`mailto:${SALES_EMAIL}`}
             style={{ ...ghost, padding: '12px 24px', fontSize: 15, textDecoration: 'none' }}>
            Talk to sales
          </a>
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

      <div style={{ background: color.cardBg, borderTop: `1px solid ${color.line}` }}>
        <Section style={{ padding: '46px 22px' }}>
          <h2 style={{ fontSize: 24, margin: '0 0 6px', textAlign: 'center' }}>
            Capacity, not just software
          </h2>
          <p style={{
            textAlign: 'center', color: color.inkSoft, maxWidth: 620,
            margin: '0 auto 24px', fontSize: 15,
          }}>
            We build and sell the connectivity too, so the billing and the bandwidth
            come from one place.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {SERVICES.map(([title, body]) => (
              <div key={title} style={{
                border: `1px solid ${color.line}`, borderRadius: radius.lg ?? 12,
                padding: '18px 18px 20px', background: color.pageBg,
              }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 15.5 }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 14, color: color.inkSoft }}>{body}</p>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13.5, color: color.muted }}>
            Talk to us about coverage and pricing:{' '}
            <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>
          </p>
        </Section>
      </div>

      <div style={{ borderTop: `1px solid ${color.line}`, borderBottom: `1px solid ${color.line}` }}>
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
          <span>Nairobi, Kenya · {SUPPORT_EMAIL}</span>
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
