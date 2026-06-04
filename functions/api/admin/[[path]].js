/**
 * in Albis Pages — Admin API Worker
 * functions/api/admin.js
 *
 * GET    /api/admin/projects              — listar proyectos
 * GET    /api/admin/projects/:id          — detalle de proyecto
 * PATCH  /api/admin/projects/:id          — cambiar estado
 * GET    /api/admin/projects/:id/notes    — notas de un proyecto
 * POST   /api/admin/projects/:id/notes    — agregar nota
 * DELETE /api/admin/notes/:id             — eliminar nota
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url   = new URL(request.url);
  const parts = url.pathname.replace(/\/api\/admin\/?/, "").split("/").filter(Boolean);
  // parts examples:
  // ["projects"]
  // ["projects", "5"]
  // ["projects", "5", "notes"]
  // ["notes", "3"]

  const resource  = parts[0];
  const id        = parts[1] ? parseInt(parts[1]) : null;
  const subresource = parts[2];

  try {
    // ── PROJECTS ──────────────────────────────────────────────
    if (resource === "projects") {

      // GET /api/admin/projects
      if (request.method === "GET" && !id) {
        const status = url.searchParams.get("status");
        let query = `
          SELECT p.*,
            (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS notes_count
          FROM projects p`;
        const params = [];
        if (status) { query += ` WHERE p.status = ?`; params.push(status); }
        query += ` ORDER BY p.created_at DESC`;

        const { results } = await env.DB.prepare(query).bind(...params).all();
        const projects = results.map(p => ({
          ...p,
          form_data: JSON.parse(p.form_data_json),
          form_data_json: undefined,
        }));
        return json({ success: true, projects });
      }

      // GET /api/admin/projects/:id
      if (request.method === "GET" && id && !subresource) {
        const project = await env.DB.prepare(
          `SELECT * FROM projects WHERE id = ?`
        ).bind(id).first();
        if (!project) return json({ success: false, message: "Proyecto no encontrado." }, 404);
        project.form_data = JSON.parse(project.form_data_json);
        delete project.form_data_json;
        return json({ success: true, project });
      }

      // PATCH /api/admin/projects/:id — cambiar estado
      if (request.method === "PATCH" && id && !subresource) {
        const { status } = await request.json();
        const allowed = ["pending", "in_progress", "completed", "archived"];
        if (!allowed.includes(status)) return json({ success: false, message: "Estado inválido." }, 400);
        await env.DB.prepare(
          `UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(status, id).run();
        return json({ success: true });
      }

      // GET /api/admin/projects/:id/notes
      if (request.method === "GET" && id && subresource === "notes") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM notes WHERE project_id = ? ORDER BY created_at ASC`
        ).bind(id).all();
        return json({ success: true, notes: results });
      }

      // POST /api/admin/projects/:id/notes
      if (request.method === "POST" && id && subresource === "notes") {
        const { content } = await request.json();
        if (!content?.trim()) return json({ success: false, message: "La nota no puede estar vacía." }, 400);
        const result = await env.DB.prepare(
          `INSERT INTO notes (project_id, content) VALUES (?, ?)`
        ).bind(id, content.trim()).run();
        return json({ success: true, note_id: result.meta?.last_row_id }, 201);
      }
    }

    // ── NOTES ─────────────────────────────────────────────────
    if (resource === "notes" && id) {
      // DELETE /api/admin/notes/:id
      if (request.method === "DELETE") {
        await env.DB.prepare(`DELETE FROM notes WHERE id = ?`).bind(id).run();
        return json({ success: true });
      }
    }

    return json({ success: false, message: "Ruta no encontrada." }, 404);

  } catch (err) {
    console.error("Admin API error:", err);
    return json({ success: false, message: "Error interno.", detail: err.message }, 500);
  }
}
