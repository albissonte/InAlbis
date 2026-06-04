// functions/api/create-payment.js
// Cloudflare Pages Function — procesa pagos con Mercado Pago Bricks
// Variable de entorno requerida: MP_ACCESS_TOKEN

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = await request.json();
    const { formData, plan, extras, totalPaid, type } = body;

    if (!formData || !plan) {
      return new Response(JSON.stringify({ success: false, message: 'Datos incompletos.' }), { status: 400, headers });
    }

    // ── Cotización USD → ARS en tiempo real (dolarapi.com) ───
    let usdToArs = 1200; // fallback si la API falla
    try {
      const dolarRes = await fetch('https://dolarapi.com/v1/dolares/blue', {
        headers: { 'Accept': 'application/json' }
      });
      if (dolarRes.ok) {
        const dolarData = await dolarRes.json();
        usdToArs = dolarData.venta || dolarData.compra || 1200;
      }
    } catch (e) {
      console.warn('No se pudo obtener cotización, usando fallback:', usdToArs);
    }

    const totalPaidARS = Math.round(totalPaid * usdToArs);

    // ── Construir el pago para MP ────────────────────────────
    const planNames = { presencia: 'Plan Presencia', negocio: 'Plan Negocio', autoridad: 'Plan Autoridad' };
    const description = `${planNames[plan] || plan}${type === 'adelanto' ? ' — Adelanto 50%' : ' — Pago total'} · Páginas inAlbis`;

    const paymentPayload = {
      transaction_amount: totalPaidARS,
      description,
      payment_method_id:  formData.payment_method_id,
      payer: {
        email:           formData.payer?.email || '',
        identification:  formData.payer?.identification || {},
      },
      metadata: {
        plan,
        extras,
        payment_type:  type,
        usd_amount:    totalPaid,
        ars_amount:    totalPaidARS,
        usd_to_ars:    usdToArs,
        source:        'inalbis_pages',
      },
    };

    // Si es tarjeta, agregar token
    if (formData.token) {
      paymentPayload.token        = formData.token;
      paymentPayload.installments = formData.installments || 1;
      paymentPayload.issuer_id    = formData.issuer_id;
    }

    // ── Llamar a la API de MP ────────────────────────────────
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(paymentPayload),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('MP error:', JSON.stringify(mpData));
      return new Response(JSON.stringify({ success: false, message: mpData.message || 'Error de Mercado Pago.' }), { status: 400, headers });
    }

    // ── Guardar en D1 ────────────────────────────────────────
    if (env.DB) {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mp_payment_id TEXT,
          plan TEXT,
          extras INTEGER,
          amount_usd INTEGER,
          amount_ars INTEGER,
          usd_to_ars REAL,
          payment_type TEXT,
          status TEXT,
          payer_email TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();

      await env.DB.prepare(`
        INSERT INTO payments (mp_payment_id, plan, extras, amount_usd, amount_ars, usd_to_ars, payment_type, status, payer_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        String(mpData.id),
        plan,
        extras || 0,
        totalPaid,
        totalPaidARS,
        usdToArs,
        type,
        mpData.status,
        formData.payer?.email || ''
      ).run();
    }

    // ── Respuesta según estado MP ────────────────────────────
    const status = mpData.status;

    if (status === 'approved') {
      return new Response(JSON.stringify({ success: true, status: 'approved', payment_id: mpData.id }), { status: 200, headers });
    } else if (status === 'in_process' || status === 'pending') {
      return new Response(JSON.stringify({ success: true, status: 'pending', payment_id: mpData.id }), { status: 200, headers });
    } else {
      return new Response(JSON.stringify({ success: false, status, message: 'Pago no aprobado.' }), { status: 400, headers });
    }

  } catch (err) {
    console.error('create-payment error:', err);
    return new Response(JSON.stringify({ success: false, message: 'Error interno.' }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
