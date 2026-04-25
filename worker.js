const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-API-Key,X-File-Name,X-File-Type',
};

const SYSTEM_PROMPT = `You are Jarvis, an AI fabrication assistant embedded in a smart home dashboard connected to a Bambu Lab P1S FDM printer and a Cricut Explore 4 cutter.

WHAT YOU CAN DO:
- Answer questions and hold conversations
- Create and manage projects (see PROJECT MANAGEMENT below)
- Generate 3D models via Meshy.AI (user-driven) or OpenSCAD (parametric)
- Search Thingiverse for existing models
- Generate SVG cut designs for the Cricut Explore 4
- Control home devices via Home Assistant

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT MANAGEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your [CONTEXT] block (injected at end of every user message) lists existing projects and the active one.

CREATE a project automatically when:
- User describes something new to make and no suitable project exists yet
- User explicitly asks to start a project
Use this tag anywhere in your response (it is processed and stripped before display):
[ACTION:create_project:Short Name:type]
  type = 3d_model | svg | other
  Short Name = 2–4 words, Title Case, descriptive
  Example: "Let's get started.[ACTION:create_project:Phone Stand:3d_model]"

DO NOT create a project if one already exists with the same purpose — just use it.
DO NOT create a project for vague conversational messages ("hello", "thanks", general questions).

DELETE the active project only when user EXPLICITLY requests deletion AND confirms.
First ask: "Are you sure you want to delete [project name]? This cannot be undone."
On confirmation, use: [ACTION:delete_project]

PROJECT TYPE ENFORCEMENT:
Active project type is injected as [PROJECT:type] prefix. Obey it:
- [PROJECT:3d_model] → 3D advice, OpenSCAD if asked, Thingiverse search. NO \`\`\`meshy blocks — user generates via ⚡ button.
- [PROJECT:svg] → \`\`\`svg blocks only. No Meshy, no OpenSCAD.
- No tag → use best judgement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3D MODELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3D generation happens through the ⚡ Generate button — users submit prompts DIRECTLY to Meshy. You do NOT output \`\`\`meshy blocks. Never.

You CAN help the user craft a better prompt if they ask ("what should I include in my Meshy prompt for X?"):
- Describe shape and structure only — no materials, finishes, or textures (it's FDM plastic)
- Single focused object, not a scene
- Use geometric terms: spherical, cylindrical, tapered, faceted, hollow, convex, ridged, chamfered
- Use structural terms: base, arm, shelf, cradle, slot, recess, groove, tab, wall, lip, bracket, cutout
- Replace functional descriptions with housing geometry:
  "cable management" → "U-shaped groove along underside with two raised retaining tabs"
  "MagSafe" → "shallow circular recessed pocket on rear face"
  "cable pass-through" → "rectangular slot through base edge"

OPENSCAD (parametric / exact dimensions only) — only when user asks for exact dimensions or says "OpenSCAD":
\`\`\`openscad
[code]
\`\`\`
- $fn=64 for smooth curves. Named variables for all dimensions (mm). Manifold only. Build volume 256×256×256mm.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SVG FOR CRICUT EXPLORE 4  (svg projects only)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

One short acknowledgment, then the block. Dashboard auto-saves and opens the SVG viewer.
\`\`\`svg
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  [paths and shapes here]
</svg>
\`\`\`

SVG RULES — read every one before generating:
1. ROOT ELEMENT: ALWAYS <svg viewBox="..." xmlns="http://www.w3.org/2000/svg"> — NEVER use <g> as the root.
2. LANGUAGE TAG: ALWAYS \`\`\`svg — NEVER \`\`\`xml or anything else.
3. ONE DESIGN PER BLOCK: output ONE focused design per \`\`\`svg block. If the user asks for multiple options, output MULTIPLE separate \`\`\`svg blocks, one per option — each with its own acknowledgment line.
4. KEEP IT CONCISE: Cricut cuts simple vector shapes. Use <path>, <circle>, <rect>, <ellipse>, <polygon>, <line>, <text>. Avoid deeply nested groups. No XML comments (<!-- -->). No inline styles — use SVG attributes.
5. CUT LINES: stroke="black" fill="none". Filled shapes = print-then-cut.
6. ALL TAGS CLOSED. No partial output — if you cannot fit the complete SVG, make it simpler instead of truncating it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THINGIVERSE SEARCH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
System auto-searches and injects results. Present naturally — cards are shown in the dashboard, no need to list URLs.

RESEARCH CAPABILITY:
You have Google Search available. Use it proactively when:
- User asks to "research" or "look up" a topic ("research Final Fantasy 8 characters", "look at phone stand designs")
- User asks for options or inspiration from real-world examples
- You need reference material before generating a design
After searching, summarise findings briefly, then proceed directly to generation (meshy or svg block).

WHAT YOU CANNOT DO:
- Directly send print or cut commands (require user confirmation)

Tone: confident, direct, slightly dry. No hollow filler phrases. No clarifying question loops — make a reasonable assumption and proceed.`;

// ── Thingiverse search ────────────────────────────────────────────────────────

async function searchThingiverse(query, env, page = 1) {
  if (!env.THINGIVERSE_TOKEN) return null;
  try {
    const params = new URLSearchParams({ type: 'things', per_page: '10', page: String(page) });
    const r = await fetch(
      `https://api.thingiverse.com/search/${encodeURIComponent(query)}?${params}`,
      { headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}` } }
    );
    if (!r.ok) return null;
    const hits = await r.json();
    return (Array.isArray(hits) ? hits : hits.hits ?? []).slice(0, 10).map(h => ({
      id:        h.id,
      title:     h.name ?? 'Untitled',
      url:       h.public_url ?? `https://www.thingiverse.com/thing:${h.id}`,
      likes:     h.like_count ?? 0,
      downloads: h.download_count ?? 0,
    })).filter(h => h.id);
  } catch (e) {
    console.error('[jarvis] Thingiverse search failed:', e.message);
    return null;
  }
}

function detectSearchIntent(message) {
  const lower = message.toLowerCase();
  const triggers = ['find me', 'find a ', 'search for', 'look for', 'show me', 'get me', 'thingiverse', 'search thingiverse'];
  const modelWords = ['model', 'design', 'stl', 'print', 'printable', 'thing', 'file', 'stand', 'holder', 'mount', 'case', 'bracket'];
  if (triggers.some(t => lower.includes(t)) || (lower.includes('find') && modelWords.some(w => lower.includes(w)))) {
    return message
      .replace(/^(please )?(find me a?n?|find a?n?|search for|look for|show me a?n?|get me a?n?|search thingiverse for|find on thingiverse|search on thingiverse)\s*/i, '')
      .replace(/\s*(on|from|in|at)\s*thingiverse/gi, '')
      .replace(/\s*(model|design|stl|3d print(able)?|thing)\s*$/i, '')
      .trim() || message.trim();
  }
  return null;
}

// ── LLM ───────────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function err(msg, status = 400) { return json({ error: msg }, status); }
// Accept key via header (dashboard fetches) OR ?key= query param (direct URL access)
function authCheck(req, env) {
  return req.headers.get('X-API-Key') === env.API_KEY ||
         new URL(req.url).searchParams.get('key') === env.API_KEY;
}
function uuid() { return crypto.randomUUID(); }

// ── LLM via Cloudflare AI Gateway ────────────────────────────────────────────
// AI_GATEWAY_BASE: set this secret to your gateway base URL, e.g.:
//   https://gateway.ai.cloudflare.com/v1/{account_id}/jarvis-gateway
// If unset, falls back to direct API calls (old behaviour).

async function callGemini(message, history, env, baseUrl) {
  const contents = [
    ...history.map(m => ({ role: m.role === 'jarvis' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  // Gateway URL: {base}/google-ai-studio/v1beta/models/gemini-2.0-flash:generateContent
  // Direct URL:  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
  const url = baseUrl
    ? `${baseUrl}/google-ai-studio/v1beta/models/gemini-2.0-flash:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;
  const r = await fetch(`${url}?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: [{ google_search: {} }],
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  // Grounded responses may have multiple parts; join all text parts
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini empty response');
  return text;
}

async function callGroq(message, history, env, baseUrl) {
  const oaiMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role === 'jarvis' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: message },
  ];
  // Gateway URL: {base}/groq/openai/v1/chat/completions
  // Direct URL:  https://api.groq.com/openai/v1/chat/completions
  const url = baseUrl
    ? `${baseUrl}/groq/openai/v1/chat/completions`
    : 'https://api.groq.com/openai/v1/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: oaiMessages }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq empty response');
  return text;
}

async function callLLM(message, history, env) {
  const base = (env.AI_GATEWAY_BASE ?? '').replace(/\/$/, '') || null;

  if (env.GEMINI_API_KEY) {
    try { return await callGemini(message, history, env, base); } catch (e) {
      console.warn('[jarvis] Gemini failed:', e.message);
    }
  }

  if (env.GROQ_API_KEY) {
    try { return await callGroq(message, history, env, base); } catch (e) {
      console.warn('[jarvis] Groq failed:', e.message);
    }
  }

  try {
    const oaiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map(m => ({ role: m.role === 'jarvis' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: message },
    ];
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: oaiMessages });
    return r.response;
  } catch (_) {
    return "I'm having trouble connecting right now. Please try again.";
  }
}

// ── Worker ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      return await handleRequest(request, env);
    } catch (e) {
      console.error('[jarvis] Unhandled worker error:', e?.message ?? e);
      return err(`Worker error: ${e?.message ?? 'unknown'}`, 500);
    }
  },
};

async function handleRequest(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, '');
    const method = request.method;

    // ── Public endpoints — no auth required ─────────────────────────────────
    // Temp images served publicly so Meshy (and other external services) can
    // fetch them. Security: protected by UUID key obscurity only.
    const publicTempMatch = path.match(/^\/api\/public\/temp\/([^/]+)$/);
    if (method === 'GET' && publicTempMatch) {
      const key = `temp/${publicTempMatch[1]}`;
      const obj = await env.FILES.get(key);
      if (!obj) return err('Not found', 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          ...CORS,
        },
      });
    }

    // ── Everything else requires auth ────────────────────────────────────────
    if (!authCheck(request, env)) return err('Unauthorized', 401);

    if (method === 'GET' && path === '/api/projects') {
      const { results } = await env.DB.prepare(
        'SELECT id,name,type,status,description,created_at,updated_at FROM projects ORDER BY updated_at DESC'
      ).all();
      return json(results);
    }

    if (method === 'POST' && path === '/api/projects') {
      const { name, type = 'other', description = '' } = await request.json();
      if (!name) return err('name is required');
      const id = uuid(), now = new Date().toISOString();
      await env.DB.prepare(
        'INSERT INTO projects (id,name,type,status,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, name, type, 'active', description, now, now).run();
      return json({ id, name, type, status:'active', description, created_at:now, updated_at:now }, 201);
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    const msgMatch     = path.match(/^\/api\/projects\/([^/]+)\/messages$/);
    const fileMatch    = path.match(/^\/api\/projects\/([^/]+)\/files$/);

    if (method === 'GET' && projectMatch) {
      const row = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(projectMatch[1]).first();
      return row ? json(row) : err('Not found', 404);
    }

    if (method === 'DELETE' && projectMatch) {
      const id = projectMatch[1];
      const { results: files } = await env.DB.prepare('SELECT r2_key FROM files WHERE project_id=?').bind(id).all();
      await Promise.all(files.map(f => env.FILES.delete(f.r2_key)));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM files WHERE project_id=?').bind(id),
        env.DB.prepare('DELETE FROM messages WHERE project_id=?').bind(id),
        env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id),
      ]);
      return json({ deleted: id });
    }

    if (method === 'GET' && msgMatch) {
      const { results } = await env.DB.prepare(
        'SELECT id,role,content,created_at FROM messages WHERE project_id=? ORDER BY created_at ASC'
      ).bind(msgMatch[1]).all();
      return json(results);
    }

    if (method === 'POST' && msgMatch) {
      const { role, content } = await request.json();
      if (!role || !content) return err('role and content are required');
      const id = uuid(), now = new Date().toISOString();
      await env.DB.prepare(
        'INSERT INTO messages (id,project_id,role,content,created_at) VALUES (?,?,?,?,?)'
      ).bind(id, msgMatch[1], role, content, now).run();
      await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now, msgMatch[1]).run();
      return json({ id, role, content, created_at: now }, 201);
    }

    if (method === 'GET' && fileMatch) {
      const { results } = await env.DB.prepare(
        'SELECT id,filename,file_type,r2_key,file_size,created_at FROM files WHERE project_id=? ORDER BY created_at DESC'
      ).bind(fileMatch[1]).all();
      return json(results);
    }

    if (method === 'POST' && fileMatch) {
      const projectId = fileMatch[1];
      const filename  = request.headers.get('X-File-Name') ?? 'upload';
      const fileType  = request.headers.get('X-File-Type') ?? 'other';
      const body      = await request.arrayBuffer();
      if (!body.byteLength) return err('empty file');
      const id = uuid(), r2Key = `${projectId}/${id}/${filename}`, now = new Date().toISOString();
      const contentTypes = { stl: 'model/stl', svg: 'image/svg+xml', '3mf': 'model/3mf' };
      await env.FILES.put(r2Key, body, { httpMetadata: { contentType: contentTypes[fileType] ?? 'application/octet-stream' } });
      await env.DB.prepare(
        'INSERT INTO files (id,project_id,filename,file_type,r2_key,file_size,created_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, projectId, filename, fileType, r2Key, body.byteLength, now).run();
      await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now, projectId).run();
      return json({ id, filename, file_type:fileType, r2_key:r2Key, file_size:body.byteLength, created_at:now }, 201);
    }

    const dlMatch = path.match(/^\/api\/files\/([^/]+)$/);
    if (method === 'GET' && dlMatch) {
      const row = await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(dlMatch[1]).first();
      if (!row) return err('Not found', 404);
      const obj = await env.FILES.get(row.r2_key);
      if (!obj) return err('File not in storage', 404);
      const contentTypes = { stl: 'model/stl', svg: 'image/svg+xml', '3mf': 'model/3mf' };
      const ct = contentTypes[row.file_type] ?? 'application/octet-stream';
      return new Response(obj.body, { headers: {'Content-Type':ct, 'Content-Disposition':`attachment; filename="${row.filename}"`, ...CORS} });
    }

    if (method === 'GET' && path === '/api/log') {
      const { results } = await env.DB.prepare(
        `SELECT m.id,m.role,m.content,m.created_at,p.name as project_name
         FROM messages m JOIN projects p ON m.project_id=p.id
         ORDER BY m.created_at DESC LIMIT 50`
      ).all();
      return json(results);
    }

    // Speech-to-text — accepts raw audio (webm/wav/mp3), returns { text }
    if (method === 'POST' && path === '/api/stt') {
      const audio = await request.arrayBuffer();
      if (!audio.byteLength) return err('empty audio');
      try {
        const result = await env.AI.run('@cf/openai/whisper', {
          audio: [...new Uint8Array(audio)],
        });
        return json({ text: result.text?.trim() ?? '' });
      } catch (e) {
        return err(`STT failed: ${e.message}`, 502);
      }
    }

    if (method === 'POST' && path === '/api/chat') {
      const { message, project_id, project_type, history = [] } = await request.json();
      if (!message) return err('message is required');

      // Inject project-type constraint so LLM knows what output mode to use
      const typeTag = project_type === '3d_model' ? '[PROJECT:3d_model] '
                    : project_type === 'svg'       ? '[PROJECT:svg] '
                    : '';

      // ── Inject project context so Jarvis knows what exists ────────────────
      const { results: allProjects } = await env.DB.prepare(
        'SELECT id, name, type FROM projects ORDER BY updated_at DESC LIMIT 20'
      ).all();
      const activeProj = project_id ? allProjects.find(p => p.id === project_id) : null;
      const projContextStr = `\n\n[CONTEXT: Active project: ${
        activeProj ? `"${activeProj.name}" (${activeProj.type})` : 'none'
      }. All projects: ${
        allProjects.length ? allProjects.map(p => `"${p.name}"(${p.type})`).join(', ') : 'none'
      }]`;

      // ── Detect Thingiverse search intent ──────────────────────────────────
      let searchResults = null;
      let llmMessage = typeTag + message + projContextStr;   // typeTag preserved even with search
      const searchQuery = detectSearchIntent(message);
      if (searchQuery) {
        searchResults = await searchThingiverse(searchQuery, env);
        if (searchResults?.length) {
          llmMessage = typeTag + message +
            '\n\n[THINGIVERSE RESULTS for "' + searchQuery + '":\n' +
            searchResults.map((r, i) =>
              `${i+1}. "${r.title}" — ${r.likes} likes, ${r.downloads} downloads — ${r.url}`
            ).join('\n') +
            '\n\nPresent these results naturally. Mention standout options by name. The cards are shown in the dashboard — no need to list URLs.]' +
            projContextStr;
        }
      }

      const rawResponse = await callLLM(llmMessage, history, env);

      // ── Process [ACTION:...] tags from Jarvis response ────────────────────
      let newProject = null;
      let deletedProjectId = null;
      const actionRe = /\[ACTION:([^\]]+)\]/g;
      let am;
      while ((am = actionRe.exec(rawResponse)) !== null) {
        const parts = am[1].split(':');
        const aType = parts[0];
        if (aType === 'create_project') {
          const pName = (parts[1] || 'New Project').trim();
          const pType = (parts[2] || 'other').trim();
          const pid = uuid(), pNow = new Date().toISOString();
          try {
            await env.DB.prepare(
              'INSERT INTO projects (id,name,type,status,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
            ).bind(pid, pName, pType, 'active', '', pNow, pNow).run();
            newProject = { id: pid, name: pName, type: pType, status: 'active', description: '', created_at: pNow, updated_at: pNow };
          } catch (e) { console.error('[jarvis] Project create failed:', e.message); }
        } else if (aType === 'delete_project') {
          const delId = project_id;
          if (delId) {
            try {
              const { results: pFiles } = await env.DB.prepare('SELECT r2_key FROM files WHERE project_id=?').bind(delId).all();
              await Promise.all(pFiles.map(f => env.FILES.delete(f.r2_key)));
              await env.DB.batch([
                env.DB.prepare('DELETE FROM files WHERE project_id=?').bind(delId),
                env.DB.prepare('DELETE FROM messages WHERE project_id=?').bind(delId),
                env.DB.prepare('DELETE FROM projects WHERE id=?').bind(delId),
              ]);
              deletedProjectId = delId;
            } catch (e) { console.error('[jarvis] Project delete failed:', e.message); }
          }
        }
      }
      // Strip action tags so they don't appear in the stored/displayed message
      const response = rawResponse.replace(/\s*\[ACTION:[^\]]+\]/g, '').trim();

      // ── Store messages (use processed project_id — might be new) ──────────
      const saveProjectId = newProject?.id ?? project_id;
      const now = new Date().toISOString();
      if (saveProjectId && !deletedProjectId) {
        const proj = await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(saveProjectId).first();
        if (proj) {
          const t2 = new Date(Date.now()+1).toISOString();
          await env.DB.batch([
            env.DB.prepare('INSERT INTO messages (id,project_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(uuid(),saveProjectId,'user',message,now),
            env.DB.prepare('INSERT INTO messages (id,project_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(uuid(),saveProjectId,'jarvis',response,t2),
            env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(t2,saveProjectId),
          ]);
        }
      }
      return json({ response, project_id: saveProjectId ?? null, search_results: searchResults, search_query: searchQuery, new_project: newProject, deleted_project_id: deletedProjectId });
    }

    // Direct paginated search (used by dashboard Load More)
    if (method === 'GET' && path === '/api/thingiverse/search') {
      const q = url.searchParams.get('q');
      const page = parseInt(url.searchParams.get('page') ?? '1');
      if (!q) return err('q required');
      const results = await searchThingiverse(q, env, page);
      return results ? json(results) : err('Search failed', 502);
    }

    // File list for a thing (STLs only)
    if (method === 'GET' && path === '/api/thingiverse/files') {
      const thingId = url.searchParams.get('thing_id');
      if (!thingId) return err('thing_id required');
      if (!env.THINGIVERSE_TOKEN) return err('not configured', 500);
      const r = await fetch(`https://api.thingiverse.com/things/${thingId}/files`, {
        headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}` },
      });
      if (!r.ok) return err(`Thingiverse API ${r.status}`, 502);
      const data = await r.json();
      const stls = (Array.isArray(data) ? data : data.files ?? [])
        .filter(f => (f.name ?? '').toLowerCase().endsWith('.stl'))
        .map(f => ({ id: f.id, name: f.name, size: f.size ?? 0 }));
      return json(stls);
    }

    // STL proxy — streams a Thingiverse file through the worker
    if (method === 'GET' && path === '/api/thingiverse/stl') {
      const thingId = url.searchParams.get('thing_id');
      const fileId  = url.searchParams.get('file_id');
      if (!thingId || !fileId) return err('thing_id and file_id required');
      if (!env.THINGIVERSE_TOKEN) return err('not configured', 500);
      const filesR = await fetch(`https://api.thingiverse.com/things/${thingId}/files`, {
        headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}` },
      });
      if (!filesR.ok) return err(`Thingiverse API ${filesR.status}`, 502);
      const data = await filesR.json();
      const file  = (Array.isArray(data) ? data : data.files ?? [])
        .find(f => String(f.id) === String(fileId));
      if (!file) return err('File not found', 404);
      const dlUrl = file.download_url ?? file.direct_url ?? file.public_url ?? file.url;
      if (!dlUrl) return err('No download URL', 404);

      // Step 1: hit Thingiverse with auth — expect a redirect to a CDN/S3 pre-signed URL.
      // Do NOT follow automatically: forwarding the Authorization header to S3 causes 400.
      const dlR1 = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}` },
        redirect: 'manual',
      });

      let finalR;
      if (dlR1.status >= 300 && dlR1.status < 400) {
        // Follow the redirect WITHOUT the auth header so S3 is happy.
        const location = dlR1.headers.get('Location');
        if (!location) return err('Download redirect missing Location header', 502);
        finalR = await fetch(location, { redirect: 'follow' });
      } else if (dlR1.ok) {
        // Some files serve directly (no redirect).
        finalR = dlR1;
      } else {
        return err(`Download failed ${dlR1.status}`, 502);
      }

      if (!finalR.ok) return err(`CDN download failed ${finalR.status}`, 502);
      return new Response(finalR.body, {
        headers: { 'Content-Type':'model/stl', 'Content-Disposition':`inline; filename="${file.name}"`, ...CORS },
      });
    }

    if (method === 'POST' && path === '/api/thingiverse/import') {
      const { thing_id, project_id } = await request.json();
      if (!thing_id || !project_id) return err('thing_id and project_id required');
      if (!env.THINGIVERSE_TOKEN) return err('Thingiverse not configured', 500);
      const proj = await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(project_id).first();
      if (!proj) return err('Project not found', 404);

      // Fetch file list for this thing
      const filesR = await fetch(`https://api.thingiverse.com/things/${thing_id}/files`, {
        headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}` },
      });
      if (!filesR.ok) return err(`Thingiverse files API returned ${filesR.status}`, 502);
      const fileList = await filesR.json();
      const stlFiles = (Array.isArray(fileList) ? fileList : fileList.files ?? [])
        .filter(f => (f.name ?? '').toLowerCase().endsWith('.stl'));
      if (!stlFiles.length) return err('No STL files found for this thing', 404);

      // Download each STL and store in R2
      const imported = [];
      const now = new Date().toISOString();
      for (const file of stlFiles) {
        const dlUrl = file.download_url ?? file.direct_url ?? file.url;
        if (!dlUrl) continue;
        const dlR = await fetch(dlUrl, {
          headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}` },
        });
        if (!dlR.ok) continue;
        const buf = await dlR.arrayBuffer();
        if (!buf.byteLength) continue;
        const id = uuid();
        const r2Key = `${project_id}/${id}/${file.name}`;
        await env.FILES.put(r2Key, buf, { httpMetadata: { contentType: 'model/stl' } });
        await env.DB.prepare(
          'INSERT INTO files (id,project_id,filename,file_type,r2_key,file_size,created_at) VALUES (?,?,?,?,?,?,?)'
        ).bind(id, project_id, file.name, 'stl', r2Key, buf.byteLength, now).run();
        imported.push({ id, filename: file.name, file_type: 'stl', r2_key: r2Key, file_size: buf.byteLength, created_at: now });
      }
      if (!imported.length) return err('Failed to download any STL files', 502);
      await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now, project_id).run();
      return json({ imported });
    }

    // ── Meshy.AI text-to-3D ──────────────────────────────────────────────────

    if (method === 'GET' && path === '/api/meshy/balance') {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const r = await fetch('https://api.meshy.ai/openapi/v1/balance', {
        headers: { Authorization: `Bearer ${env.MESHY_API_KEY}` },
      });
      if (!r.ok) return err(`Meshy API ${r.status}`, 502);
      return json(await r.json());
    }

    // ── Upload reference image to R2, return public URL for Meshy ────────────
    if (method === 'POST' && path === '/api/meshy/upload-image') {
      const body = await request.arrayBuffer();
      if (!body.byteLength) return err('empty body', 400);
      // Detect mime type from magic bytes
      const header = new Uint8Array(body, 0, 12);
      let mime = 'image/jpeg', ext = 'jpg';
      if (header[0]===0x89 && header[1]===0x50) { mime = 'image/png';  ext = 'png';  }
      else if (header[0]===0xFF && header[1]===0xD8) { mime = 'image/jpeg'; ext = 'jpg'; }
      else if (header[0]===0x52 && header[1]===0x49) { mime = 'image/webp'; ext = 'webp'; }
      else if (header[0]===0x47 && header[1]===0x49) { mime = 'image/gif';  ext = 'gif';  }
      const tempId  = uuid();
      const tempKey = `temp/${tempId}.${ext}`;
      await env.FILES.put(tempKey, body, { httpMetadata: { contentType: mime } });
      const origin   = new URL(request.url).origin;
      const publicUrl = `${origin}/api/public/temp/${tempId}.${ext}`;
      return json({ url: publicUrl, key: tempKey });
    }

    if (method === 'POST' && path === '/api/meshy/generate') {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const { prompt, image_url } = await request.json();
      // NOTE: image_data (base64) is NOT used — Meshy only accepts public URLs.
      // The dashboard uploads images via /api/meshy/upload-image first to get a URL.
      const hasImage = !!image_url;
      if (!hasImage && !prompt) return err('prompt or image_url required');

      // ── If image_url is external, proxy it through R2 so Meshy can always reach it ─────────
      // Meshy's servers can't access all public URLs (bot protection, redirects, etc.).
      // Storing the image in our own R2 gives Meshy a guaranteed-accessible URL.
      let finalImageUrl = image_url;
      if (hasImage) {
        const ownOrigin = new URL(request.url).origin;
        if (!image_url.startsWith(ownOrigin)) {
          try {
            const imgR = await fetch(image_url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JarvisBot/1.0)' },
              redirect: 'follow',
            });
            if (imgR.ok) {
              const imgBuf = await imgR.arrayBuffer();
              const ct  = imgR.headers.get('content-type') ?? 'image/jpeg';
              const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
              const tempId  = uuid();
              const tempKey = `temp/${tempId}.${ext}`;
              await env.FILES.put(tempKey, imgBuf, { httpMetadata: { contentType: ct } });
              finalImageUrl = `${ownOrigin}/api/public/temp/${tempId}.${ext}`;
              console.log('[jarvis] Proxied external image to R2:', image_url, '→', finalImageUrl);
            }
          } catch (proxyErr) {
            // Proxy failed — let Meshy try the original URL anyway
            console.warn('[jarvis] Image proxy failed, passing URL directly to Meshy:', proxyErr?.message);
          }
        }
      }

      let r;
      try {
        if (hasImage) {
          // ── Image-to-3D: Meshy fetches the image from our public R2 URL ───
          const body = { image_url: finalImageUrl };
          if (prompt) body.prompt = prompt;   // optional hint for the model
          r = await fetch('https://api.meshy.ai/openapi/v2/image-to-3d', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MESHY_API_KEY}` },
            body: JSON.stringify(body),
          });
        } else {
          // ── Text-to-3D — direct pass-through, user prompt verbatim ────────
          r = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MESHY_API_KEY}` },
            body: JSON.stringify({
              mode:          'preview',
              prompt,
              ai_model:      'meshy-6',
              model_type:    'standard',
              symmetry_mode: 'auto',
              topology:      'triangle',
            }),
          });
        }
      } catch (fetchErr) {
        console.error('[jarvis] Meshy generate fetch failed:', fetchErr?.message);
        return err(`Meshy API unreachable: ${fetchErr?.message ?? 'network error'}`, 502);
      }
      if (!r.ok) {
        // Expose full status so callers can diagnose (404=endpoint/URL not found, 400/422=bad request, 402=credits)
        const errText = await r.text().catch(() => '');
        console.error('[jarvis] Meshy generate error', r.status, errText);
        let e = {};
        try { e = JSON.parse(errText); } catch {}
        const msg = e.message || e.error || errText.slice(0, 200) || `HTTP ${r.status}`;
        return err(`Meshy ${r.status}: ${msg}`, r.status === 402 ? 402 : 502);
      }
      const data = await r.json();
      // Return mode so dashboard knows which status/save endpoint family to use
      return json({ task_id: data.result, mode: hasImage ? 'image' : 'text' });
    }

    const meshyStatusMatch = path.match(/^\/api\/meshy\/status\/([^/]+)$/);
    if (method === 'GET' && meshyStatusMatch) {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const mode = url.searchParams.get('mode') ?? 'text';
      const apiBase = mode === 'image'
        ? 'https://api.meshy.ai/openapi/v2/image-to-3d'
        : 'https://api.meshy.ai/openapi/v2/text-to-3d';
      const r = await fetch(`${apiBase}/${meshyStatusMatch[1]}`, {
        headers: { Authorization: `Bearer ${env.MESHY_API_KEY}` },
      });
      if (!r.ok) return err(`Meshy API ${r.status}`, 502);
      const task = await r.json();
      return json({
        status:        task.status,
        progress:      task.progress ?? 0,
        thumbnail_url: task.thumbnail_url ?? null,
        glb_url:       task.model_urls?.glb ?? null,
        prompt:        task.prompt ?? '',
        error:         task.task_error?.message ?? null,
      });
    }

    if (method === 'POST' && path === '/api/meshy/save') {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const { task_id, project_id, mode = 'text' } = await request.json();
      if (!task_id || !project_id) return err('task_id and project_id required');

      const proj = await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(project_id).first();
      if (!proj) return err('Project not found', 404);

      const apiBase = mode === 'image'
        ? 'https://api.meshy.ai/openapi/v2/image-to-3d'
        : 'https://api.meshy.ai/openapi/v2/text-to-3d';
      const taskR = await fetch(`${apiBase}/${task_id}`, {
        headers: { Authorization: `Bearer ${env.MESHY_API_KEY}` },
      });
      if (!taskR.ok) return err(`Meshy task fetch failed: ${taskR.status}`, 502);
      const task = await taskR.json();
      if (task.status !== 'SUCCEEDED') return err(`Task not complete (${task.status})`, 400);

      const glbUrl = task.model_urls?.glb;
      if (!glbUrl) return err('No GLB URL in completed task', 502);

      const glbR = await fetch(glbUrl);
      if (!glbR.ok) return err(`GLB download failed: ${glbR.status}`, 502);
      const glbBytes = await glbR.arrayBuffer();

      const safeName = (task.prompt ?? 'model').slice(0, 40).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `${safeName}.glb`;
      const id = uuid(), r2Key = `${project_id}/${id}/${filename}`, now = new Date().toISOString();

      await env.FILES.put(r2Key, glbBytes, { httpMetadata: { contentType: 'model/gltf-binary' } });
      await env.DB.prepare(
        'INSERT INTO files (id,project_id,filename,file_type,r2_key,file_size,created_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, project_id, filename, 'glb', r2Key, glbBytes.byteLength, now).run();
      await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now, project_id).run();

      return json({ id, filename, file_type: 'glb', r2_key: r2Key, file_size: glbBytes.byteLength, created_at: now }, 201);
    }

    return err('Not found', 404);
}
