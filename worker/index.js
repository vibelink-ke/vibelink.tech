// VIBELINK - Production SaaS Backend
// worker/index.js

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization");
    const tenantId = request.headers.get("X-Tenant-ID") || "t1";

    const handleEntity = async (tableName) => {
      const method = request.method;

      if (method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM ${tableName} WHERE tenant_id = ?`
        ).bind(tenantId).all();
        
        // Parse JSON strings back into objects
        const parsedResults = results.map(row => {
          const newRow = { ...row };
          for (const key in newRow) {
            if (typeof newRow[key] === 'string' && (newRow[key].startsWith('[') || newRow[key].startsWith('{'))) {
              try { newRow[key] = JSON.parse(newRow[key]); } catch (e) {}
            }
          }
          return newRow;
        });
        
        return Response.json(parsedResults);
      }

      if (method === "POST") {
        const data = await request.json();
        const id = crypto.randomUUID();
        
        // Stringify any objects (like 'items') for D1 storage
        const processedData = { ...data };
        for (const key in processedData) {
          if (processedData[key] && typeof processedData[key] === 'object') {
            processedData[key] = JSON.stringify(processedData[key]);
          }
        }

        const keys = Object.keys(processedData).concat(['id', 'tenant_id']);
        const placeholders = keys.map(() => '?').join(', ');
        const values = Object.values(processedData).concat([id, tenantId]);

        await env.DB.prepare(
          `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`
        ).bind(...values).run();

        return Response.json({ id, ...data });
      }

      if (method === "PUT" || request.method === "PATCH") {
        const data = await request.json();
        const id = url.pathname.split('/').pop();
        
        const processedData = { ...data };
        for (const key in processedData) {
          if (processedData[key] && typeof processedData[key] === 'object') {
            processedData[key] = JSON.stringify(processedData[key]);
          }
        }

        const setClause = Object.keys(processedData).map(k => `${k} = ?`).join(', ');
        const values = Object.values(processedData).concat([id, tenantId]);

        await env.DB.prepare(
          `UPDATE ${tableName} SET ${setClause} WHERE id = ? AND tenant_id = ?`
        ).bind(...values).run();

        return Response.json({ id, ...data });
      }

      return new Response("Method Not Allowed", { status: 405 });
    };

    const routes = {
      "/api/customers": "customers",
      "/api/plans": "plans",
      "/api/invoices": "invoices",
      "/api/payments": "payments",
      "/api/tickets": "tickets",
      "/api/mikrotiks": "mikrotiks",
      "/api/vpn/configs": "vpn_configs"
    };

    // Support dynamic ID paths (e.g. /api/customers/123)
    const baseRoute = Object.keys(routes).find(r => url.pathname.startsWith(r));
    if (baseRoute) {
      return handleEntity(routes[baseRoute]);
    }

    if (url.pathname === "/api/vpn/sync") {
      if (authHeader !== `Bearer ${env.VPN_SYNC_KEY}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const { results } = await env.DB.prepare(
        "SELECT public_key, allowed_ips FROM vpn_configs WHERE type = 'peer' AND status = 'active'"
      ).all();
      return Response.json(results);
    }

    return new Response("Not Found", { status: 404 });
  }
};
