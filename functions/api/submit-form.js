/**
 * inAlbis Pages — Form Submit Worker
 * functions/api/submit-form.js
 *
 * POST /api/submit-form
 * Guarda en D1 + WhatsApp + email bienvenida al cliente
 * + email al admin con: datos, prompt para Claude e informe de propuesta
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BREVO_KEY   = "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";
const ADMIN_EMAIL = "albissonte@gmail.com";
const FROM_NAME   = "inAlbis Pages";
const FROM_EMAIL  = "albissonte@gmail.com";
const WA_PHONE    = "46760684744";
const WA_APIKEY   = "5325624";

// Tipo de cambio USD→ARS de referencia por si falla la API
const ARS_FALLBACK = 1300;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ══════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════
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
    // Plan elegido y precio — vienen del formulario de pago
    plan:              get("plan"),              // "presencia" | "negocio" | "autoridad"
    plan_price:        get("plan_price"),        // precio en USD como string ej: "499"
    // Prompt generado en el cliente (index.html → buildPrompt())
    generated_prompt:  get("generated_prompt"),
  };

  // ── Validación básica ──
  if (!data.business_name || !data.business_type || !data.phone) {
    return json({ success: false, message: "Faltan campos obligatorios." }, 400);
  }

  const clientName = data.business_name;
  const clientSlug = slugify(clientName);
  const now        = new Date().toISOString();

  try {
    // ── 1. Tipo de cambio USD→ARS en tiempo real ──────────────
    let arsRate = ARS_FALLBACK;
    try {
      const fx = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      if (fx.ok) {
        const fxData = await fx.json();
        arsRate = fxData.rates?.ARS || ARS_FALLBACK;
      }
    } catch { /* usa fallback */ }

    // ── 2. Guardar en D1 ──────────────────────────────────────
    const result = await env.DB.prepare(
      `INSERT INTO projects (client_name, client_slug, status, form_data_json, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`
    ).bind(clientName, clientSlug, JSON.stringify(data), now, now).run();

    const projectId = result.meta?.last_row_id || 0;

    // ── 3. WhatsApp ───────────────────────────────────────────
    const goals = Array.isArray(data.main_goals) ? data.main_goals.join(", ") : "—";
    const waMsg = encodeURIComponent(
      `🔔 *Nuevo cliente — inAlbis*\n\n` +
      `👤 *Negocio:* ${clientName}\n` +
      `📧 *Email:* ${data.email}\n` +
      `📱 *Tel:* ${data.phone}\n` +
      `💼 *Plan:* ${data.plan || "—"}\n` +
      `🎯 *Objetivos:* ${goals}\n` +
      `🆔 *Proyecto #:* ${projectId}`
    );
    fetch(`https://api.callmebot.com/whatsapp.php?phone=${WA_PHONE}&text=${waMsg}&apikey=${WA_APIKEY}`)
      .catch(() => {});

    // ── 4. Email al admin: datos + prompt + informe ───────────
    await sendAdminEmail(data, projectId, arsRate);

    // ── 5. Email de bienvenida al cliente ─────────────────────
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
// DATOS POR PLAN
// ══════════════════════════════════════════════
function getPlanData(planKey, precioUSD) {
  const planes = {
    presencia: {
      nombre:    "Presencia",
      precio:    precioUSD || 249,
      soporte:   "1 mes",
      plazo:     "7–10 días hábiles",
      secciones: [
        "Inicio — Hero con slogan y botón de contacto",
        "Servicios — Lista de servicios o productos",
        "Galería — Fotos del negocio o trabajos",
        "Ubicación y horarios — Mapa + datos de contacto",
      ],
      includes: [
        "Landing page de 1 página completa",
        "Diseño mobile-first",
        "Botón WhatsApp para contacto",
        "Formulario de contacto",
        "Google Maps embed",
        "SEO básico incluido",
        "Hosting y SSL gratuitos",
        "1 mes de soporte gratuito",
      ],
    },
    negocio: {
      nombre:    "Negocio",
      precio:    precioUSD || 499,
      soporte:   "2 meses",
      plazo:     "10–14 días hábiles",
      secciones: [
        "Inicio (Hero + Historia del negocio)",
        "Servicios / Carta de productos",
        "Sobre nosotros",
        "Galería de fotos",
        "Ubicación y contacto",
        "Reservas / WhatsApp directo",
      ],
      includes: [
        "Web de 4–6 páginas",
        "Diseño premium a medida",
        "Catálogo de productos/servicios",
        "SEO local completo",
        "Google Maps + Search Console",
        "Velocidad optimizada",
        "WhatsApp multicanal",
        "Dominio .com.ar por 1 año",
        "Hosting y SSL gratuitos",
        "2 meses de soporte gratuito",
      ],
    },
    autoridad: {
      nombre:    "Autoridad",
      precio:    precioUSD || 899,
      soporte:   "3 meses",
      plazo:     "14–21 días hábiles",
      secciones: [
        "Inicio — Hero animado con propuesta de valor",
        "Servicios — Detalle completo con fotos y descripciones",
        "Sobre nosotros — Historia, equipo y valores",
        "Galería / Casos de éxito — Antes y después",
        "Blog o sección de novedades",
        "Testimonios de clientes",
        "Turnos y contacto — Formulario + WhatsApp + mapa",
        "Preguntas frecuentes",
        "Aranceles / Precios orientativos",
      ],
      includes: [
        "Hasta 10 páginas con diseño premium",
        "Blog o sección de novedades",
        "Animaciones y efectos de scroll",
        "SEO avanzado con palabras clave",
        "Google Maps + Search Console",
        "Feed de Instagram integrado",
        "Panel de edición propio",
        "WhatsApp multicanal",
        "Dominio .com.ar por 1 año",
        "Hosting y SSL gratuitos",
        "Reporte de rendimiento mensual",
        "3 meses de soporte prioritario",
        "Respuesta en menos de 24hs",
      ],
    },
  };
  return planes[planKey] || planes.negocio;
}

// ══════════════════════════════════════════════
// GENERADOR DE INFORME HTML
// ══════════════════════════════════════════════
function buildInforme(data, arsRate) {
  const planKey  = (data.plan || "negocio").toLowerCase();
  const precioNum = parseInt(data.plan_price) || 0;
  const plan     = getPlanData(planKey, precioNum);
  const precio   = plan.precio;
  const adelanto = Math.round(precio * 0.5);
  const arsTotal = Math.round(precio * arsRate).toLocaleString("es-AR");
  const arsAdel  = Math.round(adelanto * arsRate).toLocaleString("es-AR");

  const now     = new Date();
  const fechaStr = now.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const fechaCap = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);

  // Objetivos del proyecto — de los checkboxes del formulario
  const goalsArr = Array.isArray(data.main_goals) ? data.main_goals : [];
  const goalsHTML = goalsArr.length
    ? goalsArr.map((g, i) => `
        <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;">
          <div style="background:#0f2942;color:#7dd3f7;font-size:11px;font-weight:800;
            width:22px;height:22px;border-radius:50%;display:flex;align-items:center;
            justify-content:center;flex-shrink:0;margin-top:1px;">${i + 1}</div>
          <div style="font-size:14px;color:#1a3a5c;line-height:1.5;">${g}</div>
        </div>`).join("")
    : `<div style="font-size:14px;color:#3a6080;">A definir en la reunión de brief.</div>`;

  // Secciones del sitio según plan
  const seccionesHTML = plan.secciones.map((s, i) => `
    <div style="display:flex;gap:14px;align-items:center;padding:10px 0;
      border-bottom:1px solid rgba(26,143,209,0.08);">
      <div style="font-size:11px;font-weight:800;color:#7aaac8;width:24px;flex-shrink:0;">
        0${i + 1}</div>
      <div style="font-size:14px;color:#0f2942;flex:1;">${s}</div>
      <div style="color:#1a8fd1;font-size:13px;font-weight:700;">✓</div>
    </div>`).join("");

  // Features del plan — 2 columnas
  const half = Math.ceil(plan.includes.length / 2);
  const col1 = plan.includes.slice(0, half);
  const col2 = plan.includes.slice(half);
  const featCol = (arr) => arr.map(f =>
    `<div style="padding:5px 0;font-size:13px;color:#1a3a5c;">
      <span style="color:#1a8fd1;font-weight:700;margin-right:6px;">✓</span>${f}
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe de Propuesta — ${data.business_name}</title>
<style>
  body { margin:0; padding:0; background:#e8f4fd; font-family:'Segoe UI',Arial,sans-serif; }
  .page { background:#fff; max-width:780px; margin:0 auto; }
  .section { padding:36px 48px; border-bottom:1px solid #eaf2fb; }
  h2 { font-size:13px; font-weight:800; letter-spacing:0.12em; text-transform:uppercase;
       color:#1a8fd1; margin:0 0 4px; }
  h3 { font-size:22px; font-weight:700; color:#0f2942; margin:0 0 16px; }
  @media print {
    body { background:#fff; }
    .no-print { display:none; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- PORTADA -->
  <div style="background:linear-gradient(160deg,#0f2942 0%,#1a4a72 55%,#1a8fd1 100%);
    padding:52px 48px 44px; position:relative; overflow:hidden;">
    <div style="position:absolute;top:-60px;right:-60px;width:280px;height:280px;
      border-radius:50%;background:rgba(255,255,255,0.04);"></div>
    <div style="position:absolute;bottom:-40px;left:30%;width:200px;height:200px;
      border-radius:50%;background:rgba(26,143,209,0.1);"></div>

    <!-- Logo -->
    <div style="margin-bottom:32px;position:relative;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;
        color:rgba(255,255,255,0.45);margin-bottom:4px;">inAlbis</div>
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
        in<span style="color:#7dd3f7;">Albis</span> Pages</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;">
        inalbis.pages.dev · albissonte@gmail.com · +54 9 11 6811-5491</div>
    </div>

    <div style="height:1px;background:rgba(255,255,255,0.12);margin-bottom:28px;position:relative;"></div>

    <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;
      color:rgba(255,255,255,0.5);margin-bottom:10px;">INFORME DE PROPUESTA WEB</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:8px;">Propuesta Web para</div>
    <div style="font-size:34px;font-weight:800;color:#fff;line-height:1.1;margin-bottom:28px;
      letter-spacing:-0.5px;">${data.business_name}</div>

    <!-- Chips fecha / plan / inversión -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px;">
      ${[["FECHA", fechaCap], ["PLAN", plan.nombre], ["INVERSIÓN", `USD ${precio}`]].map(([l, v]) => `
        <div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);
          border-radius:8px;padding:10px 16px;backdrop-filter:blur(4px);">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
            color:rgba(255,255,255,0.45);margin-bottom:3px;">${l}</div>
          <div style="font-size:14px;font-weight:700;color:#fff;">${v}</div>
        </div>`).join("")}
    </div>

    <div style="height:1px;background:rgba(255,255,255,0.1);margin-bottom:20px;"></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;">PREPARADO PARA</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.85);">
      ${data.approver || data.business_name}
      ${data.email ? ` · <span style="color:#7dd3f7;">${data.email}</span>` : ""}
      ${data.address ? ` · ${data.address}` : ""}
    </div>
  </div>

  <!-- 1. RESUMEN DEL NEGOCIO -->
  <div class="section">
    <h2>1. Resumen del negocio</h2>
    <h3>Entendemos tu negocio</h3>
    <p style="font-size:14px;color:#3a6080;line-height:1.8;margin:0 0 24px;">
      <strong style="color:#0f2942;">${data.business_name}</strong> es un negocio dedicado a
      <strong style="color:#0f2942;">${data.business_type}</strong>.
      ${data.description
        ? ` ${data.description}`
        : ` Su objetivo es consolidar su presencia digital y atraer más clientes a través de una web profesional que refleje la identidad del negocio.`}
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
      ${[
        ["RUBRO",     data.business_type || "—"],
        ["UBICACIÓN", data.address       || "—"],
        ["CONTACTO",  data.email         || data.phone || "—"],
      ].map(([l, v]) => `
        <div style="background:#f0f8ff;border-radius:10px;padding:14px 16px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
            color:#7aaac8;margin-bottom:5px;">${l}</div>
          <div style="font-size:13px;color:#0f2942;font-weight:500;line-height:1.4;">${v}</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- 2. OBJETIVOS -->
  <div class="section">
    <h2>2. Objetivos del proyecto</h2>
    <h3>¿Qué queremos lograr?</h3>
    ${goalsHTML}
    ${data.target_audience ? `
    <div style="margin-top:20px;background:#f0f8ff;border-radius:10px;padding:16px 18px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
        color:#7aaac8;margin-bottom:6px;">PÚBLICO OBJETIVO</div>
      <div style="font-size:13px;color:#1a3a5c;line-height:1.6;">${data.target_audience}</div>
    </div>` : ""}
  </div>

  <!-- 3. ESTRUCTURA DEL SITIO -->
  <div class="section">
    <h2>3. Propuesta de sitio web</h2>
    <h3>Estructura — Plan ${plan.nombre}</h3>
    ${seccionesHTML}
  </div>

  <!-- 4. DISEÑO REFERENCIAL -->
  <div class="section">
    <h2>4. Diseño referencial</h2>
    <h3>Concepto visual propuesto</h3>
    <p style="font-size:14px;color:#3a6080;line-height:1.7;margin:0 0 20px;">
      ${data.brand_colors
        ? `Diseño basado en la paleta de colores del cliente: <strong style="color:#0f2942;">${data.brand_colors}</strong>.`
        : `Diseño moderno y profesional con paleta de colores acorde al rubro.`}
      Tipografía elegante y actual. Mobile-first para garantizar una excelente experiencia en celulares.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      ${[
        ["📱 Mobile-first", "Diseño que prioriza la experiencia en celular, donde está la mayoría de tus visitantes."],
        ["⚡ Velocidad",    "Carga en menos de 2 segundos. Fundamental para SEO y para no perder visitas."],
        ["🎨 Identidad visual", "Colores, tipografía y estilo alineados con la identidad y rubro del negocio."],
        ["🔍 SEO local",   `Optimizado para aparecer en búsquedas de ${data.address || "tu zona"}.`],
      ].map(([t, d]) => `
        <div style="background:#f8fbff;border:1px solid rgba(26,143,209,0.12);
          border-radius:10px;padding:16px 18px;">
          <div style="font-size:13px;font-weight:700;color:#0f2942;margin-bottom:5px;">${t}</div>
          <div style="font-size:12px;color:#3a6080;line-height:1.6;">${d}</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- 5. PRESUPUESTO -->
  <div class="section">
    <h2>5. Presupuesto detallado</h2>
    <h3>Inversión total — Sin costos ocultos</h3>
    <div style="text-align:center;padding:28px 0 20px;">
      <div style="font-size:52px;font-weight:800;color:#0f2942;line-height:1;letter-spacing:-2px;">
        USD ${precio}</div>
      <div style="font-size:14px;font-weight:700;color:#1a8fd1;margin:8px 0 4px;">Plan ${plan.nombre}</div>
      <div style="font-size:12px;color:#7aaac8;">Pago único · Sin cuotas obligatorias</div>
      <div style="font-size:12px;color:#7aaac8;margin-top:4px;">
        También en ARS: ARS $${arsTotal}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;">
      <div style="background:linear-gradient(135deg,#0f2942,#1a4a72);border-radius:12px;
        padding:20px;text-align:center;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
          color:rgba(255,255,255,0.5);margin-bottom:8px;">50% al inicio</div>
        <div style="font-size:26px;font-weight:800;color:#7dd3f7;">USD ${adelanto}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;">
          ARS $${arsAdel}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;">
          Para reservar tu lugar y comenzar</div>
      </div>
      <div style="background:#f0f8ff;border:1.5px solid rgba(26,143,209,0.2);
        border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
          color:#7aaac8;margin-bottom:8px;">50% al entregar</div>
        <div style="font-size:26px;font-weight:800;color:#0f2942;">USD ${adelanto}</div>
        <div style="font-size:11px;color:#7aaac8;margin-top:4px;">ARS $${arsAdel}</div>
        <div style="font-size:11px;color:#7aaac8;margin-top:6px;">
          Al aprobar el sitio terminado</div>
      </div>
    </div>
  </div>

  <!-- 6. CRONOGRAMA -->
  <div class="section">
    <h2>6. Cronograma de entrega</h2>
    <h3>Tiempo estimado: ${plan.plazo}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#0f2942;">
          ${["PERÍODO", "ETAPA", "DETALLE"].map(h =>
            `<th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:700;
              letter-spacing:0.1em;color:rgba(255,255,255,0.6);">${h}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${[
          ["Días 1–2",  "Kick-off y diseño", "Brief, paleta de colores, tipografía y wireframes para aprobación."],
          ["Días 3–7",  "Desarrollo",        "Construcción del sitio, integración de contenido y optimización."],
          ["Días 8–11", "Revisiones",        "Correcciones basadas en tu feedback. Hasta 2 rondas incluidas."],
          ["Días 12–13","SEO y testeo",      "Configuración de Google Maps, Search Console y pruebas finales."],
          ["Día 14+",   "Lanzamiento",       "Publicación del sitio, entrega de accesos y soporte inicial."],
        ].map(([p, e, d], i) => `
          <tr style="background:${i % 2 === 0 ? "#f8fbff" : "#fff"};">
            <td style="padding:11px 14px;color:#1a8fd1;font-weight:700;white-space:nowrap;">${p}</td>
            <td style="padding:11px 14px;color:#0f2942;font-weight:600;">${e}</td>
            <td style="padding:11px 14px;color:#3a6080;">${d}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- 7. QUÉ INCLUYE -->
  <div class="section">
    <h2>7. ¿Qué incluye el plan?</h2>
    <h3>Todo lo que recibís con tu inversión</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px;margin-bottom:20px;">
      <div>${featCol(col1)}</div>
      <div>${featCol(col2)}</div>
    </div>
    <div style="background:#f0f8ff;border-radius:10px;padding:14px 18px;margin-top:8px;">
      <div style="font-size:12px;color:#1a8fd1;font-weight:700;">
        Soporte incluido: ${plan.soporte}</div>
      <div style="font-size:12px;color:#3a6080;margin-top:4px;line-height:1.6;">
        Ante cualquier duda o ajuste menor, respondemos dentro de las 24hs hábiles sin costo adicional.</div>
    </div>
  </div>

  <!-- 8. PRÓXIMOS PASOS -->
  <div class="section">
    <h2>8. Próximos pasos</h2>
    <h3>¿Cómo comenzamos?</h3>
    ${[
      "Revisar y aprobar esta propuesta",
      `Abonar el 50% inicial: USD ${adelanto}`,
      "Enviar fotos, logo y textos del negocio",
      "Reunión de brief de 30 min (opcional)",
      "Inicio del desarrollo",
    ].map((s, i) => `
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px;">
        <div style="background:linear-gradient(135deg,#0f2942,#1a8fd1);color:#fff;
          font-size:12px;font-weight:800;width:26px;height:26px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</div>
        <div style="font-size:14px;color:#1a3a5c;">${s}</div>
      </div>`).join("")}
  </div>

  <!-- FOOTER -->
  <div style="background:linear-gradient(135deg,#0f2942,#1a3a5c);padding:28px 48px;
    display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
    <div>
      <div style="font-size:18px;font-weight:800;color:#fff;">
        in<span style="color:#7dd3f7;">Albis</span> Pages</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;">
        Diseño web profesional</div>
    </div>
    <div style="text-align:right;font-size:12px;color:rgba(255,255,255,0.5);line-height:1.8;">
      inalbis.pages.dev<br>
      +54 9 11 6811-5491<br>
      albissonte@gmail.com
    </div>
  </div>

</div>
</body>
</html>`;
}

// ══════════════════════════════════════════════
// EMAIL AL ADMIN
// ══════════════════════════════════════════════
async function sendAdminEmail(data, projectId, arsRate) {
  const goals     = Array.isArray(data.main_goals)        ? data.main_goals.join(", ")        : "—";
  const functions = Array.isArray(data.special_functions) ? data.special_functions.join(", ") : "—";
  const now       = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  const prompt    = data.generated_prompt || "";
  const informe   = buildInforme(data, arsRate);

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e4f2fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e4f2fb;padding:32px 16px;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid rgba(26,143,209,0.15);max-width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f2942 0%,#1a4a72 60%,#1a8fd1 100%);padding:24px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div style="font-size:20px;font-weight:800;color:#fff;">
            in<span style="color:#7dd3f7;">Albis</span> Pages</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;">
            Panel de administración</div>
        </td>
        <td align="right">
          <span style="background:rgba(255,255,255,0.12);color:#7dd3f7;font-size:11px;
            font-weight:700;padding:4px 12px;border-radius:20px;border:1px solid rgba(125,211,247,0.3);">
            PROYECTO #${projectId}</span>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- Título -->
  <tr><td style="padding:28px 32px 0;">
    <div style="font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;
      color:#7aaac8;margin-bottom:6px;">Nuevo formulario recibido</div>
    <div style="font-size:22px;font-weight:800;color:#0f2942;">${data.business_name}</div>
    <div style="font-size:13px;color:#7aaac8;margin-top:4px;">
      ${data.business_type || ""} · ${now}</div>
  </td></tr>

  <!-- Datos rápidos -->
  <tr><td style="padding:20px 32px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:#f0f8ff;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:14px 18px;border-right:1px solid rgba(26,143,209,0.1);">
          ${field("Email",    data.email ? `<a href="mailto:${data.email}" style="color:#1a8fd1;text-decoration:none;">${data.email}</a>` : "—")}
        </td>
        <td style="padding:14px 18px;border-right:1px solid rgba(26,143,209,0.1);">
          ${field("Teléfono", data.phone || "—")}
        </td>
        <td style="padding:14px 18px;">
          ${field("Plan", `<strong style="color:#1a8fd1;">${(data.plan || "—").charAt(0).toUpperCase() + (data.plan || "").slice(1)}</strong> · USD ${data.plan_price || "—"}`)}
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:16px 32px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="vertical-align:top;padding-right:12px;">
        ${field("Objetivos", goals)}
      </td>
      <td width="50%" style="vertical-align:top;">
        ${field("Funciones", functions)}
      </td>
    </tr></table>
  </td></tr>

  ${data.description ? `<tr><td style="padding:12px 32px 0;">${field("Descripción", data.description)}</td></tr>` : ""}
  ${data.extra_notes ? `<tr><td style="padding:12px 32px 0;">${field("Notas", data.extra_notes)}</td></tr>` : ""}

  <!-- Botón panel -->
  <tr><td style="padding:20px 32px 0;">
    <a href="https://inalbis.pages.dev/admin/"
      style="display:inline-block;background:linear-gradient(135deg,#0f2942,#1a8fd1);
      color:#fff;font-size:12px;font-weight:700;padding:11px 22px;border-radius:8px;
      text-decoration:none;letter-spacing:0.3px;">Ver en el panel →</a>
  </td></tr>

  <!-- PROMPT PARA CLAUDE -->
  ${prompt ? `
  <tr><td style="padding:24px 32px 0;">
    <div style="background:#0f2942;border-radius:10px 10px 0 0;padding:12px 18px;">
      <span style="font-size:11px;color:#7dd3f7;font-family:'Courier New',monospace;
        font-weight:700;letter-spacing:0.05em;">📋 PROMPT PARA CLAUDE</span>
    </div>
    <pre style="margin:0;background:#f8fbff;border:1px solid rgba(26,143,209,0.15);
      border-top:none;border-radius:0 0 10px 10px;padding:16px 18px;
      font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.7;
      color:#0f2942;white-space:pre-wrap;word-break:break-word;max-height:400px;
      overflow:auto;">${prompt.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>
  </td></tr>` : ""}

  <!-- INFORME EMBEBIDO -->
  <tr><td style="padding:24px 32px 32px;">
    <div style="background:#0f2942;border-radius:10px 10px 0 0;padding:12px 18px;">
      <span style="font-size:11px;color:#7dd3f7;font-family:'Courier New',monospace;
        font-weight:700;letter-spacing:0.05em;">📄 INFORME DE PROPUESTA — ${data.business_name.toUpperCase()}</span>
    </div>
    <div style="border:1px solid rgba(26,143,209,0.15);border-top:none;
      border-radius:0 0 10px 10px;overflow:hidden;">
      ${informe.replace(/<html[^>]*>|<\/html>|<head>[\s\S]*?<\/head>|<body[^>]*>|<\/body>/gi, "")}
    </div>
  </td></tr>

  <!-- Footer email -->
  <tr>
    <td style="background:#f0f8ff;border-top:1px solid rgba(26,143,209,0.1);
      padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#7aaac8;">
        inAlbis Pages · inalbis.pages.dev ·
        <a href="mailto:${ADMIN_EMAIL}" style="color:#7aaac8;">${ADMIN_EMAIL}</a>
      </p>
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
      to:          [{ email: ADMIN_EMAIL }],
      subject:     `🆕 Proyecto #${projectId} — ${data.business_name} · Plan ${data.plan || "—"}`,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Brevo admin email error:", res.status, err);
  }
}

// ══════════════════════════════════════════════
// EMAIL AL CLIENTE (BIENVENIDA) — sin cambios
// ══════════════════════════════════════════════
async function sendClientEmail(data) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e4f2fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e4f2fb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid rgba(26,143,209,0.2);max-width:100%;">
  <tr>
    <td style="background:linear-gradient(135deg,#0f2942 0%,#1a4a72 60%,#1a8fd1 100%);padding:36px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.5);">Páginas</p>
      <p style="margin:0 0 20px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">in<span style="color:#7dd3f7;">Albis</span></p>
      <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:100px;padding:8px 20px;">
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.9);">✅ Información recibida</p>
      </div>
    </td>
  </tr>
  <tr><td style="padding:36px 32px 24px;">
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f2942;line-height:1.3;">
      ¡Gracias, ${data.business_name}!</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#3a6080;line-height:1.7;">
      Recibimos toda la información sobre tu negocio y ya estamos revisando los detalles con atención.</p>
    <p style="margin:0 0 28px;font-size:15px;color:#3a6080;line-height:1.7;">
      En las próximas <strong style="color:#0f2942;">24 a 48 horas</strong> nos ponemos en contacto con vos para coordinar los próximos pasos.</p>
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
      Si tenés alguna duda, escribinos por WhatsApp al <a href="https://wa.me/541168115491" style="color:#1a8fd1;text-decoration:none;font-weight:600;">+54 11 6811-5491</a>.</p>
  </td></tr>
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

  if (!res.ok) console.error("Brevo client email error:", res.status, await res.text());
}

// ── Helpers ──────────────────────────────────────────────────
function field(label, value) {
  return `<p style="margin:0 0 2px;font-size:10px;font-weight:700;letter-spacing:1.5px;
    text-transform:uppercase;color:#9ca3af;">${label}</p>
    <p style="margin:0;font-size:13px;color:#374151;line-height:1.5;">${value}</p>`;
}

function slugify(str) {
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
