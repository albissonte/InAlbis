// functions/api/create-subscription.js
// Variable de entorno requerida: MP_ACCESS_TOKEN

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };

  try {
    const { email, name, plan, priceUsd } = await request.json();

    if (!email || !name || !plan || !priceUsd) {
      return new Response(JSON.stringify({ success:false, message:'Faltan datos.' }), { status:400, headers });
    }

    const planNames = {
      hosting:       'Hosting Gestionado — Páginas inAlbis',
      mantenimiento: 'Mantenimiento Web — Páginas inAlbis',
      seo:           'SEO Mensual — Páginas inAlbis',
    };
    const reason = planNames[plan] || 'Servicio Mensual — Páginas inAlbis';

    // ── Cotización USD → ARS ─────────────────────────────────
    let usdToArs = 1200;
    try {
      const dr = await fetch('https://dolarapi.com/v1/dolares/blue');
      if (dr.ok) { const d = await dr.json(); usdToArs = d.venta || d.compra || 1200; }
    } catch(e) {}
    const monthlyARS = Math.round(priceUsd * usdToArs);

    // ── Crear suscripción en MP ──────────────────────────────
    const subRes = await fetch('https://api.mercadopago.com/preapproval', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        reason,
        payer_email: email,
        auto_recurring: {
          frequency:          1,
          frequency_type:     'months',
          transaction_amount: monthlyARS,
          currency_id:        'ARS',
        },
        back_url: `https://inalbis.pages.dev/mantenimiento/?status=authorized&plan=${plan}`,
        status:   'pending',
      }),
    });

    const subData = await subRes.json();
    if (!subRes.ok) throw new Error(subData.message || 'Error creando suscripción.');

    // ── Guardar en D1 ────────────────────────────────────────
    if (env.DB) {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mp_subscription_id TEXT,
          plan TEXT,
          payer_email TEXT,
          payer_name TEXT,
          amount_usd INTEGER,
          amount_ars INTEGER,
          usd_to_ars REAL,
          status TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();

      await env.DB.prepare(`
        INSERT INTO subscriptions (mp_subscription_id, plan, payer_email, payer_name, amount_usd, amount_ars, usd_to_ars, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(subData.id, plan, email, name, priceUsd, monthlyARS, usdToArs, 'pending').run();
    }

    return new Response(JSON.stringify({ success:true, init_point:subData.init_point, id:subData.id }), { status:200, headers });

  } catch(err) {
    console.error('create-subscription error:', err);
    return new Response(JSON.stringify({ success:false, message:err.message || 'Error interno.' }), { status:500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status:204, headers:{ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } });
}
