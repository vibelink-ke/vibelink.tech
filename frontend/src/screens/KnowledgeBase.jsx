import React, { useMemo, useState } from 'react';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Textarea } from '../ui/primitives';

const CATEGORIES = ['Getting connected', 'Payments', 'Troubleshooting', 'Hotspot', 'Account'];
const BLANK = { title: '', category: 'Getting connected', body: '', published: true };

export default function KnowledgeBase() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [q, setQ] = useState('');
  const [reading, setReading] = useState(null);

  const articles = store.articles ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return articles;
    return articles.filter((a) => a.title?.toLowerCase().includes(n) || a.body?.toLowerCase().includes(n));
  }, [articles, q]);

  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.title.trim()) return store.toast('Give the article a title');
    setBusy(true);
    try {
      const created = await api.createArticle(f);
      store.setCollection('articles', (as) => [created, ...as]);
      store.toast(`"${created.title}" saved`);
      setOpen(false);
      setF(BLANK);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Knowledge base"
      subtitle="Self-serve help. The support bot answers from these before handing a chat to a person."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Write article
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Articles" value={articles.length} hint="in the base" />
        <Stat label="Published" value={articles.filter((a) => a.published).length} hint="visible to clients" />
        <Stat label="Drafts" value={articles.filter((a) => !a.published).length} hint="not yet live" />
        <Stat label="Categories" value={new Set(articles.map((a) => a.category)).size} hint="in use" />
      </Grid>

      <Card
        title="Articles"
        actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 200 }} />}
      >
        {visible.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: color.muted, fontSize: 13 }}>
            {articles.length === 0 ? 'No articles yet — write the first one' : `Nothing matches "${q}"`}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {visible.map((a) => (
              <div
                key={a.id}
                onClick={() => setReading(a)}
                style={{
                  border: `1px solid ${color.line}`,
                  borderRadius: radius.lg,
                  padding: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.title}</span>
                  <Badge tone={a.published ? 'active' : 'unused'}>{a.published ? 'Live' : 'Draft'}</Badge>
                </div>
                <span style={{ fontSize: 11.5, color: color.muted }}>{a.category}</span>
                <span style={{ fontSize: 12.5, color: color.neutralInk, lineHeight: 1.45 }}>
                  {String(a.body ?? '').slice(0, 110)}
                  {String(a.body ?? '').length > 110 ? '…' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title="Write article"
        width={620}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save article'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title">
            <Input value={f.title} onChange={set('title')} placeholder="Why is my internet slow in the evening?" />
          </Field>
          <Field label="Category">
            <Select value={f.category} onChange={set('category')} options={CATEGORIES} />
          </Field>
          <Field label="Body">
            <Textarea value={f.body} onChange={set('body')} rows={9} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!reading} title={reading?.title} width={620} onClose={() => setReading(null)}>
        {reading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 11.5, color: color.muted }}>{reading.category}</span>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{reading.body}</p>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
