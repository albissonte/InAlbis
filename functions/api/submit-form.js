/**
 * in Albis Pages — Form Submit Worker
 * functions/api/submit-form.js
 *
 * POST /api/submit-form
 * Reemplaza submit-form.php — guarda en D1 + envía emails + WhatsApp
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BREVO_KEY   = "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";
const ADMIN_EMAIL = "albissonte@gmail.com";
const FROM_NAME   = "in Albis Pages";
const FROM_EMAIL  = "albissonte@gmail.com";
const WA_PHONE    = "46760684744";
const WA_APIKEY   = "5325624";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ success: false, message: "Datos inválidos." }, 400); }

  const get    = (k) => (formData.get(k) || "").toString().trim();
  const getAll = (k) => formData.getAll(k).map(v => v.toString().trim()).filter(Boolean);

  const data = {
    business_name:     get("business_name"),
    business_type:     get("business_type"),
    phone:             get("phone"),
    email:             get("email"),
    description:       get("description"),
    address:           get("address"),
    hours:             get("hours"),
    instagram:         get("instagram"),
    other_social:      get("other_social"),
    services:          get("services"),
    design_references: get("design_references"),
    brand_colors:      get("brand_colors"),
    about_us:          get("about_us"),
    main_goals:        getAll("main_goals[]"),
    special_functions: getAll("special_functions[]"),
    payment_methods:   get("payment_methods"),
    target_audience:   get("target_audience"),
    competitors:       get("competitors"),
    domain_hosting:    get("domain_hosting"),
    approver:          get("approver"),
    deadline:          get("deadline"),
    extra_notes:       get("extra_notes"),
  };

  // ── Validación básica ──
  if (!data.business_name || !data.business_type || !data.phone) {
    return json({ success: false, message: "Faltan campos obligatorios." }, 400);
  }

  const clientName = data.business_name;
  const clientSlug = slugify(clientName);
  const now        = new Date().toISOString();

  try {
    // ── 1. Guardar en D1 ──────────────────────────────────────
    const result = await env.DB.prepare(
      `INSERT INTO projects (client_name, client_slug, status, form_data_json, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`
    ).bind(clientName, clientSlug, JSON.stringify(data), now, now).run();

    const projectId = result.meta?.last_row_id || 0;

    // ── 2. WhatsApp ───────────────────────────────────────────
    const goals = Array.isArray(data.main_goals) ? data.main_goals.join(", ") : "—";
    const waMsg = encodeURIComponent(
      `🔔 *Nuevo cliente — in Albis*\n\n` +
      `👤 *Negocio:* ${clientName}\n` +
      `📧 *Email:* ${data.email}\n` +
      `📱 *Tel:* ${data.phone}\n` +
      `🎯 *Objetivos:* ${goals}\n` +
      `🆔 *Proyecto #:* ${projectId}`
    );
    fetch(`https://api.callmebot.com/whatsapp.php?phone=${WA_PHONE}&text=${waMsg}&apikey=${WA_APIKEY}`)
      .catch(() => {});

    // ── 3. Email al admin (Brevo) ─────────────────────────────
    await sendAdminEmail(data, projectId);

    // ── 4. Email de bienvenida al cliente ─────────────────────
    if (data.email) await sendClientEmail(data);

    return json({
      success: true,
      message: "¡Formulario enviado correctamente! Nos pondremos en contacto pronto.",
      project_id: projectId,
    }, 201);

  } catch (err) {
    console.error("submit-form error:", err);
    return json({ success: false, message: "Error al guardar el proyecto." }, 500);
  }
}

// ══════════════════════════════════════════════
// EMAIL AL ADMIN
// ══════════════════════════════════════════════
async function sendAdminEmail(data, projectId) {
  const goals     = Array.isArray(data.main_goals)        ? data.main_goals.join(", ")        : "—";
  const functions = Array.isArray(data.special_functions) ? data.special_functions.join(", ") : "—";
  const now       = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;max-width:100%;">

  <tr>
    <td style="background:#0f172a;padding:20px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="color:#f8fafc;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">in Albis Pages</span></td>
        <td align="right"><span style="background:#1e293b;color:#94a3b8;font-size:11px;padding:3px 10px;border-radius:4px;">PROYECTO #${projectId}</span></td>
      </tr></table>
    </td>
  </tr>

  <tr><td style="padding:24px 28px 0;">
    <p style="margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6b7280;">Nuevo formulario</p>
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;">${data.business_name}</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">${data.business_type || ""} · ${now}</p>
  </td></tr>

  <tr><td style="padding:16px 28px 0;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>

  <tr><td style="padding:16px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="padding-bottom:14px;vertical-align:top;">
          ${field("Email", `<a href="mailto:${data.email}" style="color:#0f172a;text-decoration:none;">${data.email}</a>`)}
        </td>
        <td width="50%" style="padding-bottom:14px;vertical-align:top;">
          ${field("Teléfono", data.phone || "—")}
        </td>
      </tr>
      <tr>
        <td width="50%" style="vertical-align:top;">
          ${field("Instagram", data.instagram || "—")}
        </td>
        <td width="50%" style="vertical-align:top;">
          ${field("Deadline", data.deadline || "—")}
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:4px 28px 0;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>

  ${data.description ? `<tr><td style="padding:14px 28px 0;">${field("Descripción", data.description)}</td></tr>` : ""}

  <tr><td style="padding:14px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="vertical-align:top;padding-right:10px;">${field("Objetivos", goals)}</td>
      <td width="50%" style="vertical-align:top;">${field("Funciones", functions)}</td>
    </tr></table>
  </td></tr>

  ${data.services ? `<tr><td style="padding:10px 28px 0;">${field("Servicios", data.services)}</td></tr>` : ""}
  ${data.brand_colors ? `<tr><td style="padding:10px 28px 0;">${field("Colores", data.brand_colors)}</td></tr>` : ""}

  ${data.extra_notes ? `
  <tr><td style="padding:14px 28px 0;">
    <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;">
      ${field("Notas", data.extra_notes)}
    </div>
  </td></tr>` : ""}

  <tr><td style="padding:20px 28px;">
    <a href="https://inalbis.pages.dev/admin/" style="display:inline-block;background:#0f172a;color:#f8fafc;font-size:12px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;letter-spacing:0.3px;">Ver en el panel →</a>
  </td></tr>

  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 28px;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">in Albis Pages · inalbis.pages.dev · <a href="mailto:${ADMIN_EMAIL}" style="color:#9ca3af;">${ADMIN_EMAIL}</a></p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": BREVO_KEY,
    },
    body: JSON.stringify({
      sender:      { name: FROM_NAME, email: FROM_EMAIL },
      to:          [{ email: ADMIN_EMAIL }],
      subject:     `Proyecto #${projectId} — ${data.business_name}`,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Brevo error:", res.status, err);
  }
}

// ══════════════════════════════════════════════
// EMAIL AL CLIENTE (BIENVENIDA)
// ══════════════════════════════════════════════
async function sendClientEmail(data) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e4f2fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e4f2fb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid rgba(26,143,209,0.2);max-width:100%;">

  <!-- Header con gradiente de marca -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f2942 0%,#1a4a72 60%,#1a8fd1 100%);padding:36px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.5);">Páginas</p>
      <p style="margin:0 0 20px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">in<span style="color:#7dd3f7;">Albis</span></p>
      <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:100px;padding:8px 20px;">
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.9);">✅ Información recibida</p>
      </div>
    </td>
  </tr>

  <!-- Cuerpo -->
  <tr><td style="padding:36px 32px 24px;">
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f2942;line-height:1.3;">
      ¡Gracias, ${data.business_name}!
    </h1>
    <p style="margin:0 0 16px;font-size:15px;color:#3a6080;line-height:1.7;">
      Recibimos toda la información sobre tu negocio y ya estamos revisando los detalles con atención.
    </p>
    <p style="margin:0 0 28px;font-size:15px;color:#3a6080;line-height:1.7;">
      En las próximas <strong style="color:#0f2942;">24 a 48 horas</strong> nos ponemos en contacto con vos para coordinar los próximos pasos y arrancar con tu proyecto web.
    </p>

    <!-- Caja pasos -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f8ff;border:1.5px solid rgba(26,143,209,0.2);border-radius:10px;margin-bottom:28px;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a8fd1;">¿Qué sigue?</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">☁️</td>
            <td style="padding:6px 0;font-size:14px;color:#0f2942;line-height:1.5;">Revisamos tu información en detalle</td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;font-size:16px;">✏️</td>
            <td style="padding:6px 0;font-size:14px;color:#0f2942;line-height:1.5;">Preparamos una propuesta personalizada para tu negocio</td>
          </tr>
          <tr>
            <td style="padding:6px 0;vertical-align:top;font-size:16px;">📱</td>
            <td style="padding:6px 0;font-size:14px;color:#0f2942;line-height:1.5;">Te contactamos para coordinar una reunión</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:0;font-size:13px;color:#7aaac8;line-height:1.6;">
      Si tenés alguna duda antes de que nos comuniquemos, podés responder este email o escribirnos por WhatsApp al <a href="https://wa.me/541168115491" style="color:#1a8fd1;text-decoration:none;font-weight:600;">+54 11 6811-5491</a>.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f2942,#1a3a5c);padding:20px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:16px;font-weight:800;color:#ffffff;">in<span style="color:#7dd3f7;">Albis</span></p>
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.4);">Diseño web profesional · inalbis.pages.dev</p>
    </td>
  </tr>

</table>
</td></tr></table>
</body></html>`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": BREVO_KEY },
    body: JSON.stringify({
      sender:      { name: FROM_NAME, email: FROM_EMAIL },
      to:          [{ email: data.email, name: data.business_name }],
      subject:     `¡Recibimos tu información, ${data.business_name}! ☁️`,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Brevo client email error:", res.status, err);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function field(label, value) {
  return `<p style="margin:0 0 2px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;">${label}</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.5;">${value}</p>`;
}

function slugify(str) {
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
