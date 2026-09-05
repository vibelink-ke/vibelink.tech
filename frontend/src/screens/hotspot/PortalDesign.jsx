import React, { useState } from 'react';
import { color, font, radius, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Field, Input, Screen } from '../../ui/primitives';
import { BASE_TEMPLATES } from './templates';

/** A phone-sized render of the captive portal in the selected template's palette. */
function PortalPreview({ t, plans, banner }) {
  const demo = plans.length
    ? plans
    : [
        { id: 'a', title: '1 hour', price: 20, sub: 'unlimited' },
        { id: 'b', title: '3 hours', price: 50, sub: 'unlimited' },
        { id: 'c', title: '24 hours', price: 100, sub: '1 device' },
      ];

  const Bundle = ({ p }) => (
    <div
      style={{
        background: t.tile,
        border: `1px solid ${t.line}`,
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>{p.title}</span>
        <span style={{ fontSize: 10.5, color: t.muted }}>{p.sub ?? 'unlimited'}</span>
      </div>
      <span style={{ fontFamily: font.mono, fontSize: 12.5, color: t.accent, fontWeight: 600 }}>
        KES {kes(p.price)}
      </span>
    </div>
  );

  return (
    <div
      style={{
        width: 260,
        flex: '0 0 260px',
        background: t.bg,
        border: `1px solid ${t.line}`,
        borderRadius: 18,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 420,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: t.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
          {banner.headline || 'Your WiFi'}
        </span>
      </div>
      <span style={{ fontSize: 11, color: t.muted }}>
        {banner.subtext || 'Pick a bundle and pay with M-Pesa'}
      </span>

      {t.hasBanner && (
        <div
          style={{
            height: 56,
            borderRadius: 8,
            background: t.tile,
            border: `1px dashed ${t.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10.5,
            color: t.muted,
          }}
        >
          Banner / advert slot
        </div>
      )}

      {t.hasCodeBox && (
        <div style={{ display: 'flex', gap: 6 }}>
          <div
            style={{
              flex: 1,
              border: `1px solid ${t.line}`,
              borderRadius: 8,
              padding: '7px 9px',
              fontSize: 11,
              color: t.muted,
              background: t.tile,
            }}
          >
            Enter voucher code
          </div>
          <div style={{ background: t.accent, borderRadius: 8, padding: '7px 11px', fontSize: 11, fontWeight: 600, color: t.bg }}>Go</div>
        </div>
      )}

      <div
        style={
          t.isGrid
            ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }
            : { display: 'flex', flexDirection: 'column', gap: 7 }
        }
      >
        {demo.slice(0, t.isGrid ? 6 : 4).map((p) => (
          <Bundle key={p.id} p={p} />
        ))}
      </div>

      {t.hasBigCta && (
        <div
          style={{
            marginTop: 'auto',
            background: t.accent,
            borderRadius: 10,
            padding: '11px 12px',
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: t.bg,
          }}
        >
          Buy with M-Pesa
        </div>
      )}
    </div>
  );
}

export default function PortalDesign() {
  const store = useStore();
  const [applied, setApplied] = useState(store.hotspotSettings?.template ?? 'kadogo');
  const [preview, setPreview] = useState(applied);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState({
    headline: store.hotspotSettings?.banner_headline ?? '',
    subtext: store.hotspotSettings?.banner_subtext ?? '',
  });

  const t = BASE_TEMPLATES.find((x) => x.id === preview) ?? BASE_TEMPLATES[0];

  // This used to only flip local state and toast — nothing was ever sent to
  // the server, so the captive portal guests actually see kept whatever
  // template was last saved from the plain Settings screen, and a refresh
  // of this page silently reverted the "LIVE" badge back to that. Saving
  // through the same PUT /api/hotspot/settings the Settings screen uses
  // both persists it and (via the server's own repush-on-save) re-fetches
  // the login page onto every already-Configured router right away.
  const apply = async () => {
    setBusy(true);
    try {
      const saved = await api.saveHotspotSettings({
        ...store.hotspotSettings,
        template: preview,
        banner_headline: banner.headline,
        banner_subtext: banner.subtext,
      });
      store.setHotspotSettings(saved ?? { ...store.hotspotSettings, template: preview, banner_headline: banner.headline, banner_subtext: banner.subtext });
      setApplied(preview);
      store.toast(`${t.name} applied to the captive portal`);
    } catch (e) {
      store.toast(`Could not apply: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      actions={
        <Button variant="primary" onClick={apply} disabled={busy}>
          {busy ? 'Applying…' : `Apply ${t.name}`}
        </Button>
      }
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Card title="Templates" subtitle="Eight starting points, each tuned for a different buyer">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {BASE_TEMPLATES.map((tpl) => {
                const on = tpl.id === preview;
                const live = tpl.id === applied;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setPreview(tpl.id)}
                    style={{
                      border: `1.5px solid ${on ? color.green : color.line}`,
                      borderRadius: radius.lg,
                      padding: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      background: on ? '#f4faf7' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{tpl.name}</span>
                      {live && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: color.green, background: '#e2ebe5', padding: '2px 7px', borderRadius: radius.pill }}>
                          LIVE
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[tpl.bg, tpl.accent, tpl.tile, tpl.line, tpl.text].map((c, i) => (
                        <span key={i} style={{ width: 18, height: 18, borderRadius: 4, background: c, border: '1px solid rgba(0,0,0,.08)' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 11.5, color: color.neutralInk }}>{tpl.desc}</span>
                    <span style={{ fontSize: 11, color: color.muted }}>{tpl.bestFor}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Banner copy" subtitle="Shown at the top of the portal">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Headline">
                <Input value={banner.headline} onChange={(e) => setBanner((b) => ({ ...b, headline: e.target.value }))} placeholder="Your WiFi" />
              </Field>
              <Field label="Sub-text">
                <Input value={banner.subtext} onChange={(e) => setBanner((b) => ({ ...b, subtext: e.target.value }))} placeholder="Pick a bundle and pay with M-Pesa" />
              </Field>
            </div>
          </Card>
        </div>

        <Card title="Preview" subtitle={t.name} style={{ flex: '0 0 auto' }}>
          <PortalPreview t={t} plans={store.hsPlans ?? []} banner={banner} />
        </Card>
      </div>
    </Screen>
  );
}
