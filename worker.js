const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-API-Key,X-File-Name,X-File-Type',
};

const SYSTEM_PROMPT = `You are Jarvis, an AI assistant embedded in a smart home and fabrication dashboard with a live 3D fabrication pipeline.

WHAT YOU CAN DO:
- Answer questions and hold conversations with full context
- Generate 3D models: produce OpenSCAD code and the dashboard will render it to STL automatically
- Search Thingiverse for existing 3D models when asked to find/search for designs
- Generate SVG designs for the Cricut — produce SVG markup in a code block
- Control home devices (lights, switches, etc.) via Home Assistant

HOW 3D MODEL GENERATION WORKS:
There are two generation modes. Choose based on the request — do not ask the user which to use, just pick the right one.

**FDM PRINTER CONTEXT — critical, applies to BOTH modes:**
Every model will be physically printed on a Bambu Lab P1S FDM (fused deposition modelling) filament printer. This means:
- The printer deposits plastic layer by layer. It cannot produce wood grain, brushed aluminum, fabric, leather, chrome, or any realistic surface texture — the surface will be smooth plastic.
- Functional features must be actual physical geometry, not visual representations. "Cable management" = a physical slot, channel, or clip built into the model. "MagSafe" = a circular recess or raised ring. "Cable pass-through" = a hole or cutout. Think like a product designer, not an illustrator.
- Describe SHAPE and STRUCTURE. Do NOT describe material finish, surface texture, colour, or realistic rendering properties — those are irrelevant to a plastic print and will confuse the generator.

**DEFAULT — Meshy.AI (use this for most requests):**
For organic, aesthetic, or functional object requests, respond with a short confirmation sentence then a meshy block with an FDM-optimised prompt:
\`\`\`meshy
[Describe the 3D shape and physical structure only. Include: overall form, key functional geometry (slots, recesses, channels, clips, cutouts), proportions, and style cues that affect silhouette/form (mid-century modern = tapered legs and clean lines; industrial = angular and ribbed). Do NOT mention materials, surface finishes, colours, or textures. 2-4 sentences.]
\`\`\`

MESHY PROMPT RULES — follow these exactly:
- Translate every functional request into physical geometry. Examples:
  - "cable management" → "a U-shaped groove along the underside of the base with two raised plastic retaining tabs" — NEVER say "cable" or "wire"; describe only the structural housing, never the thing going into it
  - "MagSafe charging" → "a shallow circular recessed pocket on the rear face"
  - "ventilation" → "a row of rectangular slots along the side walls"
  - "button" → "a raised oval tactile protrusion on the top surface"
  - "speaker grille" → "a grid of small circular through-holes on the front face"
- BANNED words — these cause Meshy to literally model the object as a prop in the scene: cable, wire, cord, rope, tube, pipe, thread, strap, band, chain. Replace all of them with their structural housing: groove, channel, slot, clip, bracket, retaining tab, pass-through, recess.
- Never use: wood, aluminum, metal, leather, fabric, chrome, brushed, matte, glossy, realistic, textured, material
- Always use: slot, channel, recess, cutout, groove, rib, clip, lip, overhang, cavity, pocket, wall, base, shelf, tab, rail, bracket

**EXCEPTION — OpenSCAD (parametric/mechanical only):**
Only use OpenSCAD when the user explicitly asks for parametric design, exact dimensions, mechanical parts, threaded holes, or says "OpenSCAD". Respond with the code in an openscad block:
\`\`\`openscad
[code here]
\`\`\`
The dashboard shows a "⚙ Generate STL" button the user clicks to render it.

OPENSCAD BEST PRACTICES (when used):
- Set $fn=64 at the top for smooth curves. Use $fn=128 for fine finish.
- Think in millimeters. Use named variables at the top for all dimensions.
- Use difference() for cutouts, union() for joining, hull() for organic transitions.
- Use modules for repeated geometry. Always end with the top-level render call.
- Manifold only — no zero-thickness walls or coincident faces.
- Design for printability: avoid overhangs >45°, add chamfers where needed.
- Printer build volume: 256×256×256mm (Bambu Lab P1S).

HOW THINGIVERSE SEARCH WORKS:
When the user asks you to find, search for, or look up a model/design, the system automatically searches Thingiverse and injects the results into your context. Present the results naturally — mention the top options by name and tell the user the cards are shown below for them to click through. Do not fabricate URLs or titles beyond what is provided.

HOW SVG GENERATION WORKS:
Respond with a short confirmation then SVG markup in a \`\`\`svg code block. The dashboard automatically saves the file to the project and opens the SVG viewer — no manual steps needed.

SVG RULES for Cricut Explore 4:
- Always include a viewBox attribute. Use a sensible coordinate space (e.g. viewBox="0 0 200 200").
- Use only vector paths, circles, rects, polygons — no raster images, no foreignObject, no text that won't cut cleanly.
- For cut lines: use stroke="black" fill="none" so Cricut reads them as cut paths. Filled shapes are treated as print-then-cut.
- Keep it simple and single-colour unless the user specifically asks for layers.
- Do not include XML headers, DOCTYPE, or JavaScript in the SVG markup.
- Close all tags. Produce clean, self-contained SVG that a file parser can read without a browser.

WHAT YOU CANNOT DO:
- You cannot directly send commands to the 3D printer or Cricut (those require user confirmation)
- You cannot browse the web or access external URLs directly

Tone: confident, direct, slightly dry. Never use hollow filler phrases. Never loop asking clarifying questions — make a reasonable assumption and proceed.`;

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
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
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
    if (!authCheck(request, env)) return err('Unauthorized', 401);

    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, '');
    const method = request.method;

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
      const { message, project_id, history = [] } = await request.json();
      if (!message) return err('message is required');

      // Detect search intent and run Makerworld search if needed
      let searchResults = null;
      let llmMessage = message;
      const searchQuery = detectSearchIntent(message);
      if (searchQuery) {
        searchResults = await searchThingiverse(searchQuery, env);
        if (searchResults?.length) {
          llmMessage = message + '\n\n[THINGIVERSE RESULTS for "' + searchQuery + '":\n' +
            searchResults.map((r, i) =>
              `${i+1}. "${r.title}" — ${r.likes} likes, ${r.downloads} downloads — ${r.url}`
            ).join('\n') +
            '\n\nPresent these results naturally. Mention standout options by name. The cards are already shown in the dashboard — no need to list URLs.]';
        }
      }

      const response = await callLLM(llmMessage, history, env);
      const now = new Date().toISOString();
      if (project_id) {
        const proj = await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(project_id).first();
        if (proj) {
          const t2 = new Date(Date.now()+1).toISOString();
          await env.DB.batch([
            env.DB.prepare('INSERT INTO messages (id,project_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(uuid(),project_id,'user',message,now),
            env.DB.prepare('INSERT INTO messages (id,project_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(uuid(),project_id,'jarvis',response,t2),
            env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(t2,project_id),
          ]);
        }
      }
      return json({ response, project_id: project_id ?? null, search_results: searchResults, search_query: searchQuery });
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

    if (method === 'POST' && path === '/api/meshy/generate') {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const { prompt, art_style = 'realistic', negative_prompt = 'low quality, distorted, deformed' } = await request.json();
      if (!prompt) return err('prompt required');
      let r;
      try {
        r = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MESHY_API_KEY}` },
          body: JSON.stringify({ mode: 'preview', prompt, art_style, negative_prompt }),
        });
      } catch (fetchErr) {
        console.error('[jarvis] Meshy generate fetch failed:', fetchErr?.message);
        return err(`Meshy API unreachable: ${fetchErr?.message ?? 'network error'}`, 502);
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return err(e.message ?? `Meshy API ${r.status}`, r.status === 402 ? 402 : 502);
      }
      const data = await r.json();
      return json({ task_id: data.result });
    }

    const meshyStatusMatch = path.match(/^\/api\/meshy\/status\/([^/]+)$/);
    if (method === 'GET' && meshyStatusMatch) {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const r = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${meshyStatusMatch[1]}`, {
        headers: { Authorization: `Bearer ${env.MESHY_API_KEY}` },
      });
      if (!r.ok) return err(`Meshy API ${r.status}`, 502);
      const task = await r.json();
      // Return a clean subset so the dashboard doesn't need to know the full schema
      return json({
        status:        task.status,           // PENDING | IN_PROGRESS | SUCCEEDED | FAILED | EXPIRED
        progress:      task.progress ?? 0,
        thumbnail_url: task.thumbnail_url ?? null,
        glb_url:       task.model_urls?.glb  ?? null,
        prompt:        task.prompt            ?? '',
        error:         task.task_error?.message ?? null,
      });
    }

    if (method === 'POST' && path === '/api/meshy/save') {
      if (!env.MESHY_API_KEY) return err('Meshy not configured', 500);
      const { task_id, project_id } = await request.json();
      if (!task_id || !project_id) return err('task_id and project_id required');

      const proj = await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(project_id).first();
      if (!proj) return err('Project not found', 404);

      // Re-fetch task to get model URLs (avoids passing URLs through the client)
      const taskR = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${task_id}`, {
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
