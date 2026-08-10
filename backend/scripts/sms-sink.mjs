#!/usr/bin/env node
/**
 * Local SMS sink — a stand-in provider for testing the messaging pipeline.
 *
 *   node scripts/sms-sink.mjs
 *
 * Then in Settings → SMS gateways choose `custom` and set:
 *   url            http://127.0.0.1:7788/send
 *   body_template  {"phone":"{to}","text":"{message}"}
 *   balance_url    http://127.0.0.1:7788/balance
 *
 * Every message the app sends is printed here instead of going to a real network,
 * so you can watch receipts, fair-use warnings and bulk sends without spending
 * credits or texting a real customer.
 */
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 7788);
const sent = [];

const read = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader('content-type', 'application/json');

    if (url.pathname === '/balance') {
      res.end(JSON.stringify({ balance: 1000 - sent.length }));
      return;
    }

    if (url.pathname === '/sent') {
      res.end(JSON.stringify(sent));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/send') {
      const raw = await read(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = { raw };
      }
      const entry = { at: new Date().toISOString(), ...body };
      sent.push(entry);
      console.log(`\n── SMS #${sent.length} ─────────────────────────`);
      console.log(`to   : ${entry.phone ?? entry.to ?? '(no phone field)'}`);
      console.log(`text : ${entry.text ?? entry.message ?? JSON.stringify(body)}`);
      res.end(JSON.stringify({ status: 'ok', id: `sink-${sent.length}` }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  })
  .listen(PORT, '127.0.0.1', () =>
    console.log(`sms sink on http://127.0.0.1:${PORT}  (POST /send, GET /balance, GET /sent)`)
  );
