// ============================================================================
// Línea familiar — app.js (versión completa)
// Árbol genealógico + línea temporal + eventos/historias + mapa + perfiles
// Vanilla JS + Supabase
// ============================================================================

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const el = document.getElementById("app");

// ------------------------------- Estado ------------------------------------
let state = {
  phase: "loading", code: null, family: null, meId: null,
  view: "timeline",   // timeline | map | tree
  selectedYear: 2025,
  openPersonId: null,  // perfil individual abierto
  adding: false,       // formulario de añadir persona
  addingEvent: false,  // formulario de añadir evento
  addingInfo: null,    // {personId} para añadir actividad/ubicación
};

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

// Guardar en Supabase sin esperar — fire-and-forget
function persistFamily() {
  if (state.code && state.family) {
    db.from("families").update({ data: state.family }).eq("code", state.code).then(() => {});
  }
}

// ---------------------------- Utilidades -----------------------------------
const byId = (people, id) => people.find((p) => p.id === id);
const childrenOf = (people, id) => people.filter((p) => p.parentIds.includes(id));
const partnershipsOf = (couples, id) =>
  couples.filter((cp) => cp.a === id || cp.b === id).map((cp) => ({ partnerId: cp.a === id ? cp.b : cp.a, ex: cp.ex }));
const partnerIdsOf = (couples, id) => partnershipsOf(couples, id).map((p) => p.partnerId);
const pointAt = (list, year) => { const past = (list || []).filter((l) => l.from <= year); return past.length ? past[past.length - 1] : null; };
const newId = () => "p" + Math.random().toString(36).slice(2, 9);

function groupsFor(people, couples, id) {
  const groups = {};
  partnershipsOf(couples, id).forEach((pt) => { groups[pt.partnerId] = { kids: [], ex: pt.ex }; });
  childrenOf(people, id).forEach((k) => {
    const other = k.parentIds.find((pid) => pid !== id) || null;
    const key = other || "__solo__";
    if (!groups[key]) groups[key] = { kids: [], ex: false };
    groups[key].kids.push(k);
  });
  return groups;
}
function trueRootIds(people, couples) {
  return people
    .filter((p) => p.parentIds.length === 0)
    .filter((p) => { const partner = partnerIdsOf(couples, p.id)[0]; return !(partner && partner < p.id); })
    .map((p) => p.id);
}

function statusFor(m, year) {
  const birth = m.birthYear || 0;
  if (year < birth) return "not-born";
  if (m.deathYear && year > m.deathYear) return "gone";
  return "alive";
}

function getYearRange(family) {
  const { people, events } = family;
  let min = 9999, max = new Date().getFullYear();
  people.forEach((p) => { if (p.birthYear && p.birthYear < min) min = p.birthYear; });
  (events || []).forEach((e) => { if (e.year < min) min = e.year; if (e.year > max) max = e.year; });
  if (min > max) min = max - 5;
  return { min: min - 2, max: max + 2 };
}

// ------------------------- Parentesco --------------------------------------
function ancestorsWithDist(people, id) {
  const dist = { [id]: 0 };
  let frontier = [id], d = 0;
  while (frontier.length) {
    d++;
    const next = [];
    frontier.forEach((fid) => {
      (byId(people, fid)?.parentIds || []).forEach((pid) => {
        if (!(pid in dist)) { dist[pid] = d; next.push(pid); }
      });
    });
    frontier = next;
  }
  return dist;
}
const WORDS = {
  hijo: ["hijo", "hija"], padre: ["padre", "madre"], hermano: ["hermano", "hermana"],
  abuelo: ["abuelo", "abuela"], nieto: ["nieto", "nieta"], bisabuelo: ["bisabuelo", "bisabuela"],
  bisnieto: ["bisnieto", "bisnieta"], tio: ["tío", "tía"], sobrino: ["sobrino", "sobrina"],
  primo: ["primo", "prima"], tioabuelo: ["tío abuelo", "tía abuela"], sobrinonieto: ["sobrino nieto", "sobrina nieta"],
  conyuge: ["marido", "mujer"], cunado: ["cuñado", "cuñada"], yerno: ["yerno", "nuera"],
  suegro: ["suegro", "suegra"], expareja: ["expareja", "expareja"],
};
const word = (key, gender) => { const w = WORDS[key]; return w ? w[gender === "F" ? 1 : 0] : null; };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function bloodKey(people, meId, targetId) {
  if (meId === targetId) return null;
  const meAnc = ancestorsWithDist(people, meId), tgtAnc = ancestorsWithDist(people, targetId);
  let best = null;
  Object.keys(meAnc).forEach((a) => {
    if (a in tgtAnc) {
      const up = meAnc[a], down = tgtAnc[a];
      if (!best || up + down < best.up + best.down) best = { up, down };
    }
  });
  if (!best) return null;
  const { up, down } = best;
  if (up === 0) return down === 1 ? "hijo" : down === 2 ? "nieto" : down === 3 ? "bisnieto" : null;
  if (down === 0) return up === 1 ? "padre" : up === 2 ? "abuelo" : up === 3 ? "bisabuelo" : null;
  if (up === 1 && down === 1) return "hermano";
  if (up === 2 && down === 1) return "tio";
  if (up === 1 && down === 2) return "sobrino";
  if (up === 2 && down === 2) return "primo";
  if (up === 3 && down === 1) return "tioabuelo";
  if (up === 1 && down === 3) return "sobrinonieto";
  return null;
}
const POLITICAL = { hermano: "cunado", hijo: "yerno", padre: "suegro", tio: "tio", primo: "primo", sobrino: "sobrino", abuelo: "abuelo", nieto: "nieto" };

function relationLabel(people, couples, meId, targetId) {
  if (meId === targetId) return "Tú";
  const direct = bloodKey(people, meId, targetId);
  if (direct) return cap(word(direct, byId(people, targetId).gender));
  const cpl = couples.find((cp) => (cp.a === meId && cp.b === targetId) || (cp.a === targetId && cp.b === meId));
  if (cpl) return cap(word(cpl.ex ? "expareja" : "conyuge", byId(people, targetId).gender));
  for (const partnerId of partnerIdsOf(couples, targetId)) {
    const k = bloodKey(people, meId, partnerId);
    if (k && POLITICAL[k]) return cap(word(POLITICAL[k], byId(people, targetId).gender));
  }
  for (const sp of partnerIdsOf(couples, meId)) {
    const k = bloodKey(people, sp, targetId);
    if (k === "padre") return cap(word("suegro", byId(people, targetId).gender));
    if (k === "hermano") return cap(word("cunado", byId(people, targetId).gender));
  }
  return "Familiar";
}

// -------------------------------- Supabase ---------------------------------
async function fetchFamily(code) {
  const { data, error } = await db.from("families").select("data").eq("code", code.trim().toLowerCase()).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
async function insertFamily(code, family) {
  const { error } = await db.from("families").insert({ code: code.trim().toLowerCase(), data: family });
  if (error) throw error;
}

// ================================ RENDER ===================================
function render() {
  el.className = (state.phase === "tree" || state.phase === "main") ? "tree-active" : "";
  el.innerHTML = "";
  if (state.phase === "loading") { el.innerHTML = '<div class="loading">Cargando…</div>'; return; }
  if (state.phase === "entry") return renderEntry();
  if (state.phase === "create") return renderCreate();
  if (state.phase === "join") return renderJoin();
  if (state.phase === "who") return renderWho();
  if (state.phase === "main") return renderMain();
}

// ---------------------- Entry / Create / Join / Who ------------------------
function renderEntry() {
  const wrap = document.createElement("div"); wrap.className = "panel";
  wrap.innerHTML = `
    <div class="title">Línea familiar</div>
    <div class="subtitle">Un árbol y una historia, solo para los tuyos</div>
    <button class="btn btn-primary" id="btn-create" style="margin-bottom:10px">Crear una familia nueva</button>
    <button class="btn btn-secondary" id="btn-join">Ya tengo un código</button>`;
  el.appendChild(wrap);
  wrap.querySelector("#btn-create").onclick = () => setState({ phase: "create" });
  wrap.querySelector("#btn-join").onclick = () => setState({ phase: "join" });
}

function renderCreate() {
  const wrap = document.createElement("div"); wrap.className = "panel";
  wrap.innerHTML = `
    <button class="btn-back" id="btn-back">← Volver</button>
    <div class="title" style="font-size:20px;margin-bottom:18px">Crear una familia</div>
    <label>Nombre de la familia</label><input id="f-name" placeholder="p. ej. Familia Páez" />
    <label>Tu nombre</label><input id="f-you" placeholder="Tu nombre" />
    <div class="gender-toggle"><button data-g="F">Mujer</button><button data-g="M" class="active">Hombre</button></div>
    <label>Año de nacimiento (opcional)</label><input id="f-birth" type="number" placeholder="p. ej. 1998" />
    <label>Código de acceso</label><input id="f-code" placeholder="p. ej. paez2024" />
    <div class="hint">Quien tenga este código podrá entrar</div>
    <div class="error-text" id="f-error" style="display:none"></div>
    <button class="btn btn-primary" id="f-submit">Crear familia</button>`;
  el.appendChild(wrap);
  wrap.querySelector("#btn-back").onclick = () => setState({ phase: "entry" });
  let gender = "M";
  wrap.querySelectorAll(".gender-toggle button").forEach((b) => {
    b.onclick = () => { gender = b.dataset.g; wrap.querySelectorAll(".gender-toggle button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); };
  });
  const errEl = wrap.querySelector("#f-error"), btn = wrap.querySelector("#f-submit");
  btn.onclick = async () => {
    const familyName = wrap.querySelector("#f-name").value.trim();
    const yourName = wrap.querySelector("#f-you").value.trim();
    const code = wrap.querySelector("#f-code").value.trim();
    const birthYear = parseInt(wrap.querySelector("#f-birth").value) || null;
    if (!familyName || !yourName || !code) { errEl.textContent = "Rellena los campos"; errEl.style.display = "block"; return; }
    btn.disabled = true; btn.textContent = "Creando…"; errEl.style.display = "none";
    try {
      const existing = await fetchFamily(code);
      if (existing) { errEl.textContent = "Ya existe ese código"; errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Crear familia"; return; }
      const me = { id: "p1", name: yourName, gender, parentIds: [], birthYear, deathYear: null, locations: [], activities: [] };
      const family = { name: familyName, people: [me], couples: [], events: [] };
      await insertFamily(code, family);
      localStorage.setItem("lf_code", code.trim().toLowerCase());
      localStorage.setItem("lf_me", me.id);
      setState({ phase: "main", code: code.trim().toLowerCase(), family, meId: me.id, selectedYear: birthYear || 2025 });
    } catch (err) {
      errEl.textContent = "Error al crear. Revisa config.js y que la tabla exista en Supabase.";
      errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Crear familia";
    }
  };
}

function renderJoin() {
  const wrap = document.createElement("div"); wrap.className = "panel";
  wrap.innerHTML = `
    <button class="btn-back" id="btn-back">← Volver</button>
    <div class="title" style="font-size:20px;margin-bottom:6px">Entrar con código</div>
    <div class="subtitle">Pide el código a quien creó vuestra familia</div>
    <input id="j-code" placeholder="Código de familia" style="text-align:center" />
    <div class="error-text" id="j-error" style="display:none"></div>
    <button class="btn btn-primary" id="j-submit">Entrar</button>`;
  el.appendChild(wrap);
  wrap.querySelector("#btn-back").onclick = () => setState({ phase: "entry" });
  const errEl = wrap.querySelector("#j-error"), btn = wrap.querySelector("#j-submit");
  btn.onclick = async () => {
    const code = wrap.querySelector("#j-code").value.trim();
    if (!code) return;
    btn.disabled = true; btn.textContent = "Entrando…"; errEl.style.display = "none";
    try {
      const family = await fetchFamily(code);
      if (!family) { errEl.textContent = "No existe ese código"; errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Entrar"; return; }
      // Migrar datos antiguos si no tienen events/locations/activities
      if (!family.events) family.events = [];
      family.people.forEach((p) => { if (!p.locations) p.locations = []; if (!p.activities) p.activities = []; if (!p.birthYear) p.birthYear = null; if (!p.deathYear) p.deathYear = null; });
      localStorage.setItem("lf_code", code.trim().toLowerCase());
      setState({ phase: "who", code: code.trim().toLowerCase(), family });
    } catch (err) {
      errEl.textContent = "Error al entrar"; errEl.style.display = "block"; btn.disabled = false; btn.textContent = "Entrar";
    }
  };
}

function renderWho() {
  const wrap = document.createElement("div"); wrap.className = "panel"; wrap.style.maxWidth = "420px";
  wrap.innerHTML = `
    <div class="title" style="font-size:20px;margin-bottom:4px">¿Quién eres tú?</div>
    <div class="subtitle">Parentescos relativos a ti, en ${state.family.name}</div>
    <input id="w-search" placeholder="Buscar tu nombre…" />
    <div class="people-grid" id="w-grid"></div>`;
  el.appendChild(wrap);
  function renderGrid(q) {
    const grid = wrap.querySelector("#w-grid");
    const list = state.family.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    grid.innerHTML = list.map((p) => `<button class="person-chip" data-id="${p.id}"><span class="avatar">${p.name.charAt(0)}</span>${p.name}</button>`).join("")
      || '<div class="empty-note">Nadie con ese nombre.</div>';
    grid.querySelectorAll(".person-chip").forEach((btn) => {
      btn.onclick = () => { localStorage.setItem("lf_me", btn.dataset.id); setState({ phase: "main", meId: btn.dataset.id }); };
    });
  }
  renderGrid("");
  wrap.querySelector("#w-search").oninput = (e) => renderGrid(e.target.value);
}

// ========================== PANTALLA PRINCIPAL ==============================
function renderMain() {
  const { family, meId, view, selectedYear, openPersonId, adding, addingEvent, addingInfo } = state;
  const { people, couples, events = [] } = family;
  const me = byId(people, meId);

  const wrap = document.createElement("div"); wrap.className = "panel wide";
  el.appendChild(wrap);

  // ---- Header ----
  const header = document.createElement("div"); header.className = "tree-header";
  header.innerHTML = `
    <div><div class="title" style="font-size:20px">${family.name}</div>
    <div class="subtitle" style="margin:0">Viendo como ${me?.name || "?"}</div></div>
    <div class="tree-actions">
      <button class="small-btn" id="btn-change">Cambiar</button>
      <button class="btn-link" id="btn-leave">Salir</button>
    </div>`;
  wrap.appendChild(header);
  header.querySelector("#btn-change").onclick = () => setState({ phase: "who" });
  header.querySelector("#btn-leave").onclick = () => {
    localStorage.removeItem("lf_code"); localStorage.removeItem("lf_me");
    setState({ phase: "entry", code: null, family: null, meId: null });
  };

  // ---- Tabs ----
  const tabs = document.createElement("div"); tabs.className = "tabs-bar";
  tabs.innerHTML = `
    <button class="tab-btn ${view === "timeline" ? "active" : ""}" data-v="timeline">📅 Línea</button>
    <button class="tab-btn ${view === "map" ? "active" : ""}" data-v="map">🗺️ Mapa</button>
    <button class="tab-btn ${view === "tree" ? "active" : ""}" data-v="tree">🌳 Árbol</button>`;
  wrap.appendChild(tabs);
  tabs.querySelectorAll(".tab-btn").forEach((b) => {
    b.onclick = () => setState({ view: b.dataset.v, openPersonId: null, adding: false, addingEvent: false, addingInfo: null });
  });

  // ---- Perfil individual ----
  if (openPersonId) {
    renderProfile(wrap, people, couples, events, meId, openPersonId);
    return;
  }

  // ---- Year scrubber (para timeline y mapa) ----
  if (view === "timeline" || view === "map") {
    renderYearScrubber(wrap, family, selectedYear);
  }

  // ---- Vistas ----
  if (view === "timeline") renderTimeline(wrap, family, meId, selectedYear);
  if (view === "map") renderMap(wrap, family, meId, selectedYear);
  if (view === "tree") renderTreeView(wrap, family, meId);
}

// ======================== YEAR SCRUBBER ====================================
function renderYearScrubber(wrap, family, selectedYear) {
  const { min, max } = getYearRange(family);
  const events = family.events || [];
  const scrubber = document.createElement("div"); scrubber.className = "scrubber-wrap";
  let html = '<div class="scrubber">';
  for (let y = min; y <= max; y++) {
    const hasEvent = events.some((e) => e.year === y) || family.people.some((p) => p.birthYear === y || p.deathYear === y);
    const isSelected = y === selectedYear;
    const isDecade = y % 10 === 0;
    html += `<button class="scrub-tick${isSelected ? " sel" : ""}${hasEvent ? " has" : ""}" data-y="${y}">`;
    if (isSelected) html += '<span class="scrub-dot"></span>';
    html += `<span class="scrub-bar" style="height:${isSelected ? 30 : isDecade ? 20 : hasEvent ? 14 : 8}px"></span>`;
    if (isDecade) html += `<span class="scrub-label">${y}</span>`;
    html += '</button>';
  }
  html += '</div>';
  scrubber.innerHTML = html;
  wrap.appendChild(scrubber);

  // Scroll to selected year
  requestAnimationFrame(() => {
    const selEl = scrubber.querySelector(".scrub-tick.sel");
    if (selEl) selEl.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
  });

  scrubber.querySelectorAll(".scrub-tick").forEach((b) => {
    b.onclick = () => setState({ selectedYear: parseInt(b.dataset.y) });
  });

  // Year display
  const yearDisplay = document.createElement("div"); yearDisplay.className = "year-display";
  yearDisplay.textContent = selectedYear;
  wrap.appendChild(yearDisplay);
}

// ======================== TIMELINE VIEW ====================================
function renderTimeline(wrap, family, meId, year) {
  const { people, couples, events = [] } = family;
  const present = people.filter((p) => statusFor(p, year) !== "not-born").sort((a, b) => (a.birthYear || 0) - (b.birthYear || 0));
  const yearEvents = events.filter((e) => e.year === year);
  // Auto-events (births/deaths)
  people.forEach((p) => {
    if (p.birthYear === year) yearEvents.push({ id: "b-" + p.id, year, category: "vital", title: `Nace ${p.name}`, desc: "", memberIds: [p.id] });
    if (p.deathYear === year) yearEvents.push({ id: "d-" + p.id, year, category: "vital", title: `Fallece ${p.name}`, desc: "", memberIds: [p.id] });
  });

  const countEl = document.createElement("div"); countEl.className = "year-count";
  countEl.textContent = `${present.length} integrante${present.length !== 1 ? "s" : ""}`;
  wrap.appendChild(countEl);

  // Botón añadir evento
  const addBtn = document.createElement("div"); addBtn.style.padding = "0 20px 12px";
  addBtn.innerHTML = '<button class="small-btn" style="background:var(--brass);color:var(--card);font-weight:600;padding:6px 12px;font-size:12px" id="btn-add-event">+ Añadir evento en ' + year + '</button>';
  wrap.appendChild(addBtn);
  addBtn.querySelector("#btn-add-event").onclick = () => setState({ addingEvent: true });

  if (state.addingEvent) renderAddEventForm(wrap, family, year);

  // Eventos del año
  if (yearEvents.length > 0) {
    const section = document.createElement("div"); section.className = "section";
    section.innerHTML = '<div class="section-label">EVENTOS</div>';
    yearEvents.forEach((ev) => {
      const card = document.createElement("div"); card.className = "event-card";
      const names = (ev.memberIds || []).map((id) => byId(people, id)?.name).filter(Boolean).join(", ");
      card.innerHTML = `
        <div class="event-head"><div class="event-title">${ev.title}</div></div>
        <div class="event-desc">${ev.desc || ""}</div>
        ${names ? `<div class="event-members">${names}</div>` : ""}
        ${ev.story ? `<button class="event-expand">Leer historia ▾</button><div class="event-story" style="display:none">${ev.story}</div>` : ""}`;
      section.appendChild(card);
      const expandBtn = card.querySelector(".event-expand");
      if (expandBtn) {
        expandBtn.onclick = () => {
          const storyEl = card.querySelector(".event-story");
          const open = storyEl.style.display !== "none";
          storyEl.style.display = open ? "none" : "block";
          expandBtn.textContent = open ? "Leer historia ▾" : "Cerrar historia ▴";
        };
      }
    });
    wrap.appendChild(section);
  }

  // Lista de integrantes ese año
  const section = document.createElement("div"); section.className = "section";
  section.innerHTML = '<div class="section-label">LA FAMILIA ESE AÑO</div>';
  present.forEach((p) => {
    const age = year - (p.birthYear || year);
    const status = statusFor(p, year);
    const loc = pointAt(p.locations, year);
    const act = pointAt(p.activities, year);
    const isYou = p.id === meId;
    const row = document.createElement("div"); row.className = "person-row" + (status === "gone" ? " gone" : "");
    row.innerHTML = `
      <div class="person-avatar${isYou ? " you" : ""}">${p.name.charAt(0)}</div>
      <div class="person-info">
        <div class="person-name${isYou ? " you" : ""}">${p.name}</div>
        <div class="person-meta">${act ? act.label : ""}${act && loc ? " · " : ""}${loc ? loc.city : ""}</div>
      </div>
      <div class="person-age">${status === "gone" ? "† " + p.deathYear : age + " años"}</div>`;
    row.onclick = () => setState({ openPersonId: p.id });
    section.appendChild(row);
  });
  wrap.appendChild(section);
}

// ======================== MAP VIEW =========================================
function renderMap(wrap, family, meId, year) {
  const { people } = family;
  const present = people.filter((p) => statusFor(p, year) !== "not-born");
  const byCity = {};
  present.forEach((p) => {
    const loc = pointAt(p.locations, year);
    if (!loc) return;
    if (!byCity[loc.city]) byCity[loc.city] = { loc, people: [] };
    byCity[loc.city].people.push(p);
  });

  const MAP_W = 400, MAP_H = 220;
  const LON_MIN = -130, LON_MAX = 50, LAT_MIN = -55, LAT_MAX = 70;
  function project(lat, lng) {
    return { x: ((lng - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_W, y: ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_H };
  }

  const mapWrap = document.createElement("div"); mapWrap.className = "map-wrap";
  let svgContent = '';
  // Grid lines
  for (let i = 0; i < 8; i++) {
    const lon = LON_MIN + (i * (LON_MAX - LON_MIN)) / 7;
    const { x } = project(0, lon);
    svgContent += `<line x1="${x}" y1="0" x2="${x}" y2="${MAP_H}" stroke="var(--line)" stroke-width="0.5"/>`;
  }
  for (let i = 0; i < 6; i++) {
    const lat = LAT_MIN + (i * (LAT_MAX - LAT_MIN)) / 5;
    const { y } = project(lat, 0);
    svgContent += `<line x1="0" y1="${y}" x2="${MAP_W}" y2="${y}" stroke="${lat === 0 ? 'var(--brass-dim)' : 'var(--line)'}" stroke-width="${lat === 0 ? 1 : 0.5}"/>`;
  }
  // Pins
  Object.entries(byCity).forEach(([city, group]) => {
    const { x, y } = project(group.loc.lat, group.loc.lng);
    group.people.forEach((p, idx) => {
      const offset = (idx - (group.people.length - 1) / 2) * 24;
      const isYou = p.id === meId;
      svgContent += `<circle cx="${x + offset}" cy="${y}" r="12" fill="${isYou ? 'var(--brass)' : 'var(--card)'}" stroke="var(--brass)" stroke-width="1.5"/>`;
      svgContent += `<text x="${x + offset}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="600" fill="${isYou ? 'var(--card)' : 'var(--paper)'}" font-family="'Fraunces',serif">${p.name.charAt(0)}</text>`;
    });
    svgContent += `<text x="${x}" y="${y + 26}" text-anchor="middle" font-size="8.5" fill="var(--paper)" font-family="'Inter',sans-serif">${city}</text>`;
  });

  mapWrap.innerHTML = `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" style="width:100%;display:block;overflow:visible">${svgContent}</svg>`;
  wrap.appendChild(mapWrap);

  // City list
  const cityList = document.createElement("div"); cityList.className = "city-list";
  Object.entries(byCity).forEach(([city, group]) => {
    const row = document.createElement("div"); row.className = "city-row";
    row.innerHTML = `<span>${city}, ${group.loc.country}</span><span class="city-names">${group.people.map((p) => p.name).join(", ")}</span>`;
    cityList.appendChild(row);
  });
  wrap.appendChild(cityList);

  if (Object.keys(byCity).length === 0) {
    const note = document.createElement("div"); note.className = "empty-note"; note.style.padding = "20px"; note.style.textAlign = "center";
    note.textContent = "Aún no hay ubicaciones registradas. Toca un integrante en la pestaña Línea y añádele ubicación.";
    wrap.appendChild(note);
  }
}

// ======================== TREE VIEW ========================================
function renderTreeView(wrap, family, meId) {
  const { people, couples } = family;

  // Add person button
  const addWrap = document.createElement("div"); addWrap.style.padding = "0 20px 16px";
  addWrap.innerHTML = `<button class="small-btn" style="background:var(--brass);color:var(--card);font-weight:600;padding:8px 14px;font-size:12.5px" id="btn-add">${state.adding ? "Cerrar" : "+ Añadir familiar"}</button>`;
  wrap.appendChild(addWrap);
  addWrap.querySelector("#btn-add").onclick = () => setState({ adding: !state.adding });
  if (state.adding) renderAddPersonForm(wrap, family);

  // Tree
  const scroll = document.createElement("div"); scroll.className = "tree-scroll";
  const canvas = document.createElement("div"); canvas.className = "tree-canvas";
  scroll.appendChild(canvas);
  wrap.appendChild(scroll);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "none");
  canvas.appendChild(svg);

  const nodeEls = {};
  const rendered = new Set();

  // Encontrar las raíces reales: personas sin padres que no son la pareja
  // secundaria de otra raíz. Agrupamos parejas para no renderizar a ambos
  // como raíces separadas.
  const noParent = people.filter((p) => p.parentIds.length === 0);
  const rootGroups = []; // cada grupo: { primary: id, partner: id|null }
  const usedAsPartner = new Set();

  noParent.forEach((p) => {
    if (usedAsPartner.has(p.id)) return;
    // Buscar si esta persona tiene pareja (vía couples o vía hijos compartidos)
    let partnerId = null;
    // 1. Por couples
    const cpls = couples.filter((c) => c.a === p.id || c.b === p.id);
    if (cpls.length > 0) {
      partnerId = cpls[0].a === p.id ? cpls[0].b : cpls[0].a;
    }
    // 2. Por hijos compartidos
    if (!partnerId) {
      const kids = childrenOf(people, p.id);
      for (const kid of kids) {
        const otherParent = kid.parentIds.find((pid) => pid !== p.id);
        if (otherParent) { partnerId = otherParent; break; }
      }
    }
    // Solo agrupar si la pareja también es raíz (sin padres)
    if (partnerId && byId(people, partnerId)?.parentIds?.length === 0) {
      usedAsPartner.add(partnerId);
      rootGroups.push({ primary: p.id, partner: partnerId });
    } else {
      rootGroups.push({ primary: p.id, partner: null });
    }
  });

  // Renderizar cada grupo raíz
  rootGroups.forEach((rg) => {
    const el = buildFamilyUnit(rg.primary, rg.partner, people, couples, meId, nodeEls, rendered);
    canvas.appendChild(el);
  });

  // ---- GENTE QUE NO APARECIÓ ----
  // Si alguien no fue renderizado (datos mal conectados, error al añadir, etc.)
  // lo mostramos abajo para que no se pierda y el usuario pueda editarlo.
  const missing = people.filter((p) => !rendered.has(p.id));
  if (missing.length > 0) {
    const missingWrap = document.createElement("div");
    missingWrap.style.cssText = "padding:16px 20px 0;border-top:1px solid var(--line);margin-top:16px";
    missingWrap.innerHTML = '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--paper-soft);margin-bottom:8px;text-align:center">Sin conexión visible — toca para editar</div>';
    const missingGrid = document.createElement("div");
    missingGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;justify-content:center";
    missing.forEach((p) => {
      const card = buildCard(p, people, couples, meId, nodeEls);
      card.style.opacity = "0.7";
      missingGrid.appendChild(card);
      rendered.add(p.id);
    });
    missingWrap.appendChild(missingGrid);
    wrap.appendChild(missingWrap);
  }

  // Dibujar las líneas de conexión padre→hijo
  requestAnimationFrame(() => {
    const cRect = canvas.getBoundingClientRect();
    if (!cRect.width) return;
    let paths = "";
    people.forEach((p) => {
      if (p.parentIds.length === 0) return;
      const childEl = nodeEls[p.id]; if (!childEl) return;
      const cr = childEl.getBoundingClientRect();
      const childX = cr.left + cr.width / 2 - cRect.left, childY = cr.top - cRect.top;
      let sumX = 0, count = 0, maxBottom = 0;
      p.parentIds.forEach((pid) => {
        const pEl = nodeEls[pid];
        if (pEl) { const pr = pEl.getBoundingClientRect(); sumX += pr.left + pr.width / 2 - cRect.left; count++; maxBottom = Math.max(maxBottom, pr.bottom - cRect.top); }
      });
      if (count === 0) return;
      const parentX = sumX / count, parentY = maxBottom, midY = parentY + (childY - parentY) / 2;
      paths += `<path d="M${parentX} ${parentY} L${parentX} ${midY} L${childX} ${midY} L${childX} ${childY}" fill="none" stroke="var(--line)" stroke-width="1.5"/>`;
    });
    svg.innerHTML = paths;
    svg.setAttribute("viewBox", `0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);
  });
}

// Construir una unidad familiar: pareja (o persona sola) + sus hijos recursivamente
function buildFamilyUnit(primaryId, partnerId, people, couples, meId, nodeEls, rendered) {
  const container = document.createElement("div"); container.className = "tree-group";

  // La pareja
  const coupleRow = document.createElement("div"); coupleRow.className = "tree-couple";
  const primary = byId(people, primaryId);
  if (!rendered.has(primaryId)) {
    coupleRow.appendChild(buildCard(primary, people, couples, meId, nodeEls));
    rendered.add(primaryId);
  }
  if (partnerId && !rendered.has(partnerId)) {
    const partner = byId(people, partnerId);
    const isEx = couples.some((c) => ((c.a === primaryId && c.b === partnerId) || (c.a === partnerId && c.b === primaryId)) && c.ex);
    const conn = document.createElement("div");
    conn.className = "tree-connector" + (isEx ? " ex" : "");
    coupleRow.appendChild(conn);
    coupleRow.appendChild(buildCard(partner, people, couples, meId, nodeEls));
    rendered.add(partnerId);
  }
  container.appendChild(coupleRow);

  // Hijos de esta pareja concreta
  const kids = people.filter((p) => {
    if (rendered.has(p.id)) return false;
    if (partnerId) {
      return p.parentIds.includes(primaryId) && p.parentIds.includes(partnerId);
    } else {
      return p.parentIds.includes(primaryId);
    }
  });

  if (kids.length > 0) {
    const childrenWrap = document.createElement("div"); childrenWrap.className = "tree-children";
    kids.forEach((kid) => {
      // Ver si este hijo tiene pareja (con hijos) → renderizar como unidad familiar
      const kidPartners = findPartnersWithKids(kid.id, people, couples, rendered);
      if (kidPartners.length > 0) {
        kidPartners.forEach((kp) => {
          childrenWrap.appendChild(buildFamilyUnit(kid.id, kp, people, couples, meId, nodeEls, rendered));
        });
      } else {
        // Ver si tiene pareja sin hijos (vía couples)
        const couplePartner = couples.find((c) => (c.a === kid.id || c.b === kid.id) && !rendered.has(c.a === kid.id ? c.b : c.a));
        if (couplePartner) {
          const cpId = couplePartner.a === kid.id ? couplePartner.b : couplePartner.a;
          childrenWrap.appendChild(buildFamilyUnit(kid.id, cpId, people, couples, meId, nodeEls, rendered));
        } else {
          // Solo, sin pareja
          if (!rendered.has(kid.id)) {
            childrenWrap.appendChild(buildCard(kid, people, couples, meId, nodeEls));
            rendered.add(kid.id);
          }
        }
      }
    });
    container.appendChild(childrenWrap);
  }

  return container;
}

// Encontrar las parejas de una persona que tienen hijos en común
function findPartnersWithKids(personId, people, couples, rendered) {
  const partnerIds = new Set();
  childrenOf(people, personId).forEach((kid) => {
    if (rendered.has(kid.id)) return;
    kid.parentIds.forEach((pid) => { if (pid !== personId) partnerIds.add(pid); });
  });
  const soloKids = childrenOf(people, personId).filter((k) => !rendered.has(k.id) && k.parentIds.length === 1);
  const result = [...partnerIds];
  if (soloKids.length > 0 && result.length === 0) result.push(null);
  return result;
}

function buildCard(p, people, couples, meId, nodeEls) {
  const isYou = p.id === meId;
  const btn = document.createElement("button"); btn.className = "card" + (isYou ? " you" : "");
  btn.innerHTML = `
    <div class="avatar-lg">${p.name.charAt(0)}</div>
    <div class="cname">${p.name}</div>
    <div class="crel">${isYou ? "tú" : relationLabel(people, couples, meId, p.id)}</div>`;
  btn.onclick = () => setState({ openPersonId: p.id });
  nodeEls[p.id] = btn;
  return btn;
}

// ======================== PROFILE VIEW =====================================
function renderProfile(wrap, people, couples, events, meId, personId) {
  const p = byId(people, personId);
  if (!p) { setState({ openPersonId: null }); return; }
  const rel = relationLabel(people, couples, meId, personId);

  const section = document.createElement("div"); section.className = "section"; section.style.padding = "0 20px";
  section.innerHTML = `
    <button class="btn-back" id="btn-back-profile">← Volver</button>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
      <div class="person-avatar big${p.id === meId ? " you" : ""}">${p.name.charAt(0)}</div>
      <div>
        <div style="font-family:'Fraunces',serif;font-weight:600;font-size:22px">${p.name}</div>
        <div style="font-size:12.5px;color:var(--paper-soft)">${rel} · ${p.birthYear || "?"}${p.deathYear ? " – " + p.deathYear : " – hoy"}</div>
      </div>
    </div>`;
  wrap.appendChild(section);
  section.querySelector("#btn-back-profile").onclick = () => setState({ openPersonId: null, addingInfo: null });

  // ---- Botones de acción ----
  const btns = document.createElement("div"); btns.style.cssText = "padding:0 20px 12px;display:flex;gap:8px;flex-wrap:wrap";
  btns.innerHTML = `
    <button class="small-btn" id="btn-add-loc" style="font-size:11px">+ Ubicación</button>
    <button class="small-btn" id="btn-add-act" style="font-size:11px">+ Actividad</button>
    <button class="small-btn" id="btn-edit" style="font-size:11px">✏️ Editar</button>
    ${!p.deathYear ? '<button class="small-btn" id="btn-death" style="font-size:11px">🕊️ Fallecimiento</button>' : ''}
    ${p.id !== meId ? '<button class="small-btn" id="btn-delete" style="font-size:11px;border-color:var(--danger);color:var(--danger)">🗑️ Eliminar</button>' : ''}`;
  wrap.appendChild(btns);
  btns.querySelector("#btn-add-loc").onclick = () => setState({ addingInfo: { personId, type: "location" } });
  btns.querySelector("#btn-add-act").onclick = () => setState({ addingInfo: { personId, type: "activity" } });
  btns.querySelector("#btn-edit").onclick = () => setState({ addingInfo: { personId, type: "edit" } });
  const deathBtn = btns.querySelector("#btn-death");
  if (deathBtn) deathBtn.onclick = () => setState({ addingInfo: { personId, type: "death" } });
  const deleteBtn = btns.querySelector("#btn-delete");
  if (deleteBtn) deleteBtn.onclick = () => setState({ addingInfo: { personId, type: "delete" } });

  // ---- Formularios condicionales ----
  if (state.addingInfo && state.addingInfo.personId === personId) {
    const t = state.addingInfo.type;
    if (t === "location" || t === "activity") renderAddInfoForm(wrap, t, personId);
    if (t === "edit") renderEditForm(wrap, p);
    if (t === "death") renderDeathForm(wrap, p);
    if (t === "delete") renderDeleteConfirm(wrap, p);
  }

  // ---- Timeline de esta persona ----
  const timeline = document.createElement("div"); timeline.className = "profile-timeline";
  const entries = [];
  if (p.birthYear) entries.push({ year: p.birthYear, icon: "🎒", title: "Nace", desc: rel });
  (p.activities || []).forEach((a) => entries.push({ year: a.from, icon: "💼", title: a.label }));
  (p.locations || []).forEach((l) => entries.push({ year: l.from, icon: "📍", title: `${l.city}, ${l.country}` }));
  (events || []).filter((e) => (e.memberIds || []).includes(personId)).forEach((e) => entries.push({ year: e.year, icon: "📖", title: e.title, desc: e.story || e.desc, isEvent: true }));
  if (p.deathYear) entries.push({ year: p.deathYear, icon: "🕊️", title: "Fallece", desc: p.birthYear ? `A los ${p.deathYear - p.birthYear} años.` : "" });
  entries.sort((a, b) => a.year - b.year);

  entries.forEach((entry) => {
    const row = document.createElement("div"); row.className = "tl-row";
    row.innerHTML = `
      <div class="tl-year">${entry.year}</div>
      <div class="tl-line"></div>
      <div class="tl-content${entry.isEvent ? " event" : ""}">
        <div class="tl-title">${entry.icon} ${entry.title}</div>
        ${entry.desc ? `<div class="tl-desc">${entry.desc}</div>` : ""}
      </div>`;
    timeline.appendChild(row);
  });
  if (entries.length === 0) {
    timeline.innerHTML = '<div class="empty-note" style="padding:8px 20px">Aún no hay datos registrados para esta persona.</div>';
  }
  wrap.appendChild(timeline);
}

// ---- Formulario de editar persona ----
function renderEditForm(wrap, p) {
  const form = document.createElement("div"); form.className = "add-form";
  form.innerHTML = `
    <div class="form-title">Editar a ${p.name}</div>
    <label>Nombre</label><input id="ed-name" value="${p.name}" />
    <div class="gender-toggle">
      <button data-g="F" class="${p.gender === 'F' ? 'active' : ''}">Mujer</button>
      <button data-g="M" class="${p.gender === 'M' ? 'active' : ''}">Hombre</button>
    </div>
    <label>Año de nacimiento</label><input id="ed-birth" type="number" value="${p.birthYear || ''}" placeholder="p. ej. 1960" />
    <label>Año de fallecimiento (dejar vacío si vive)</label><input id="ed-death" type="number" value="${p.deathYear || ''}" placeholder="" />
    <div class="actions">
      <button class="btn btn-secondary" id="ed-cancel">Cancelar</button>
      <button class="btn btn-primary" id="ed-save">Guardar</button>
    </div>`;
  wrap.appendChild(form);
  let gender = p.gender;
  form.querySelectorAll(".gender-toggle button").forEach((b) => {
    b.onclick = () => { gender = b.dataset.g; form.querySelectorAll(".gender-toggle button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); };
  });
  form.querySelector("#ed-cancel").onclick = () => setState({ addingInfo: null });
  form.querySelector("#ed-save").onclick = () => {
    const name = form.querySelector("#ed-name").value.trim();
    if (!name) return;
    const birthYear = parseInt(form.querySelector("#ed-birth").value) || null;
    const deathYear = parseInt(form.querySelector("#ed-death").value) || null;
    const updatedPeople = state.family.people.map((x) => x.id === p.id ? { ...x, name, gender, birthYear, deathYear } : x);
    const updatedFamily = { ...state.family, people: updatedPeople };
    setState({ family: updatedFamily, addingInfo: null });
    persistFamily();
  };
}

// ---- Formulario de fecha de fallecimiento ----
function renderDeathForm(wrap, p) {
  const form = document.createElement("div"); form.className = "add-form";
  form.innerHTML = `
    <div class="form-title">Registrar fallecimiento de ${p.name}</div>
    <label>Año de fallecimiento</label><input id="dth-year" type="number" placeholder="p. ej. 2020" />
    <div class="actions">
      <button class="btn btn-secondary" id="dth-cancel">Cancelar</button>
      <button class="btn btn-primary" id="dth-save">Guardar</button>
    </div>`;
  wrap.appendChild(form);
  form.querySelector("#dth-cancel").onclick = () => setState({ addingInfo: null });
  form.querySelector("#dth-save").onclick = () => {
    const year = parseInt(form.querySelector("#dth-year").value);
    if (!year) return;
    const updatedPeople = state.family.people.map((x) => x.id === p.id ? { ...x, deathYear: year } : x);
    const updatedFamily = { ...state.family, people: updatedPeople };
    setState({ family: updatedFamily, addingInfo: null });
    persistFamily();
  };
}

// ---- Confirmar borrado ----
function renderDeleteConfirm(wrap, p) {
  const hasChildren = childrenOf(state.family.people, p.id).length > 0;
  const form = document.createElement("div"); form.className = "add-form";
  form.innerHTML = `
    <div class="form-title" style="color:var(--danger)">Eliminar a ${p.name}</div>
    ${hasChildren
      ? '<div style="font-size:12.5px;color:var(--danger);margin-bottom:12px">Esta persona tiene hijos/as en el árbol. Si la eliminas, sus hijos perderán ese vínculo.</div>'
      : '<div style="font-size:12.5px;color:var(--paper-soft);margin-bottom:12px">Se eliminará del árbol y de todos los eventos en los que participe.</div>'
    }
    <div class="actions">
      <button class="btn btn-secondary" id="del-cancel">Cancelar</button>
      <button class="btn btn-primary" id="del-confirm" style="background:var(--danger)">Sí, eliminar</button>
    </div>`;
  wrap.appendChild(form);
  form.querySelector("#del-cancel").onclick = () => setState({ addingInfo: null });
  form.querySelector("#del-confirm").onclick = () => {
    const updatedPeople = state.family.people
      .filter((x) => x.id !== p.id)
      .map((x) => ({ ...x, parentIds: x.parentIds.filter((pid) => pid !== p.id) }));
    const updatedCouples = state.family.couples.filter((c) => c.a !== p.id && c.b !== p.id);
    const updatedEvents = (state.family.events || []).map((e) => ({ ...e, memberIds: (e.memberIds || []).filter((mid) => mid !== p.id) }));
    const updatedFamily = { ...state.family, people: updatedPeople, couples: updatedCouples, events: updatedEvents };
    setState({ family: updatedFamily, openPersonId: null, addingInfo: null });
    persistFamily();
  };
}

// ======================== ADD FORMS ========================================
function renderAddPersonForm(wrap, family) {
  const { people } = family;
  const form = document.createElement("div"); form.className = "add-form";
  form.innerHTML = `
    <div class="form-title">Añadir familiar</div>
    <input id="a-name" placeholder="Nombre" />
    <div class="gender-toggle"><button data-g="F">Mujer</button><button data-g="M" class="active">Hombre</button></div>
    <label>Año de nacimiento (opcional)</label><input id="a-birth" type="number" placeholder="p. ej. 1960" />
    <div class="section-label" style="margin-top:10px">PARENTESCOS (puedes añadir varios)</div>
    <div id="rels-list"></div>
    <button type="button" class="small-btn" id="a-add-rel" style="margin-bottom:14px;font-size:11px">+ Añadir parentesco</button>
    <div class="error-text" id="a-error" style="display:none"></div>
    <div class="actions"><button class="btn btn-secondary" id="a-cancel">Cancelar</button><button class="btn btn-primary" id="a-submit">Añadir</button></div>`;
  wrap.appendChild(form);

  let gender = "M";
  form.querySelectorAll(".gender-toggle button").forEach((b) => {
    b.onclick = () => { gender = b.dataset.g; form.querySelectorAll(".gender-toggle button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); };
  });

  const RELS = [
    { id: "hijo", label: "Es hijo/a de" },
    { id: "padre", label: "Es padre/madre de" },
    { id: "pareja", label: "Es pareja de" },
    { id: "hermano", label: "Es hermano/a de" },
  ];
  const rels = []; // {type, to}
  const relsList = form.querySelector("#rels-list");

  function addRelRow(defaults) {
    const idx = rels.length;
    rels.push(defaults || { type: "hijo", to: people[0]?.id || "" });
    renderRels();
  }
  function renderRels() {
    relsList.innerHTML = "";
    rels.forEach((r, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;margin-bottom:8px;align-items:center";
      row.innerHTML = `
        <select data-field="type" data-i="${i}" style="flex:1;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;color:var(--paper);font-family:inherit">
          ${RELS.map((rl) => `<option value="${rl.id}" ${r.type === rl.id ? "selected" : ""}>${rl.label}</option>`).join("")}
        </select>
        <select data-field="to" data-i="${i}" style="flex:1.2;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;color:var(--paper);font-family:inherit">
          ${people.map((p) => `<option value="${p.id}" ${r.to === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
        </select>
        <button type="button" data-del="${i}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:4px">×</button>`;
      relsList.appendChild(row);
      row.querySelectorAll("select").forEach((sel) => {
        sel.onchange = () => { rels[parseInt(sel.dataset.i)][sel.dataset.field] = sel.value; };
      });
      row.querySelector("[data-del]").onclick = () => { rels.splice(i, 1); renderRels(); };
    });
  }
  addRelRow(); // empieza con un parentesco
  form.querySelector("#a-add-rel").onclick = () => addRelRow();

  form.querySelector("#a-cancel").onclick = () => setState({ adding: false });
  form.querySelector("#a-submit").onclick = () => {
    const errEl = form.querySelector("#a-error");
    const name = form.querySelector("#a-name").value.trim();
    const birthYear = parseInt(form.querySelector("#a-birth").value) || null;
    if (!name) { errEl.textContent = "Ponle un nombre"; errEl.style.display = "block"; return; }
    if (rels.length === 0) { errEl.textContent = "Añade al menos un parentesco"; errEl.style.display = "block"; return; }

    const id = newId();
    const person = { id, name, gender, parentIds: [], birthYear, deathYear: null, locations: [], activities: [] };
    let newCouples = [];
    let patchMap = {}; // id → { parentIds: [...] }

    rels.forEach((r) => {
      if (r.type === "hijo") {
        if (!person.parentIds.includes(r.to)) person.parentIds.push(r.to);
      } else if (r.type === "padre") {
        const child = byId(people, r.to);
        if (child && child.parentIds.length < 2) {
          if (!patchMap[child.id]) patchMap[child.id] = { parentIds: [...child.parentIds] };
          if (!patchMap[child.id].parentIds.includes(id)) patchMap[child.id].parentIds.push(id);
          // Si el hijo ya tenía otro progenitor, hacer pareja automática
          const otherParent = patchMap[child.id].parentIds.find((pid) => pid !== id);
          if (otherParent) {
            const alreadyCouple = newCouples.some((c) => (c.a === otherParent && c.b === id) || (c.a === id && c.b === otherParent));
            if (!alreadyCouple) newCouples.push({ a: otherParent, b: id, ex: false });
          }
        }
      } else if (r.type === "pareja") {
        const alreadyCouple = newCouples.some((c) => (c.a === r.to && c.b === id) || (c.a === id && c.b === r.to))
          || family.couples.some((c) => (c.a === r.to && c.b === id) || (c.a === id && c.b === r.to));
        if (!alreadyCouple) newCouples.push({ a: r.to, b: id, ex: false });
      } else if (r.type === "hermano") {
        const sibling = byId(people, r.to);
        if (sibling) {
          sibling.parentIds.forEach((pid) => {
            if (!person.parentIds.includes(pid)) person.parentIds.push(pid);
          });
        }
      }
    });

    // Si tiene exactamente 2 padres asignados como hijo, emparejar a los padres automáticamente
    if (person.parentIds.length === 2) {
      const [p1, p2] = person.parentIds;
      const alreadyCouple = newCouples.some((c) => (c.a === p1 && c.b === p2) || (c.a === p2 && c.b === p1))
        || family.couples.some((c) => (c.a === p1 && c.b === p2) || (c.a === p2 && c.b === p1));
      if (!alreadyCouple) newCouples.push({ a: p1, b: p2, ex: false });
    }

    const updatedPeople = people
      .map((p) => patchMap[p.id] ? { ...p, ...patchMap[p.id] } : p)
      .concat([person]);
    const updatedFamily = { ...family, people: updatedPeople, couples: [...family.couples, ...newCouples] };
    setState({ family: updatedFamily, adding: false });
    persistFamily();
  };
}

function renderAddEventForm(wrap, family, year) {
  const { people } = family;
  const CATS = [{ id: "vital", label: "Hito vital" }, { id: "mudanza", label: "Mudanza" }, { id: "trabajo", label: "Trabajo/Estudios" }, { id: "foto", label: "Foto/Recuerdo" }];
  const form = document.createElement("div"); form.className = "add-form";
  form.innerHTML = `
    <div class="form-title">Nuevo evento en ${year}</div>
    <input id="e-title" placeholder="Título del evento" />
    <input id="e-desc" placeholder="Descripción corta" />
    <textarea id="e-story" placeholder="Historia larga (opcional)" rows="3" style="width:100%;box-sizing:border-box;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:13px;color:var(--paper);font-family:inherit;resize:vertical;margin-bottom:10px"></textarea>
    <select id="e-cat">${CATS.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}</select>
    <label style="margin-bottom:6px">¿A quién afecta? (mantén pulsado para varios)</label>
    <select id="e-members" multiple style="height:80px">${people.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
    <div style="height:8px"></div>
    <div class="actions"><button class="btn btn-secondary" id="e-cancel">Cancelar</button><button class="btn btn-primary" id="e-submit">Añadir</button></div>`;
  wrap.appendChild(form);
  form.querySelector("#e-cancel").onclick = () => setState({ addingEvent: false });
  form.querySelector("#e-submit").onclick = () => {
    const title = form.querySelector("#e-title").value.trim();
    if (!title) return;
    const ev = {
      id: "ev" + Math.random().toString(36).slice(2, 7),
      year, title,
      desc: form.querySelector("#e-desc").value.trim(),
      story: form.querySelector("#e-story").value.trim(),
      category: form.querySelector("#e-cat").value,
      memberIds: Array.from(form.querySelector("#e-members").selectedOptions).map((o) => o.value),
    };
    const updatedFamily = { ...state.family, events: [...(state.family.events || []), ev] };
    setState({ family: updatedFamily, addingEvent: false });
    persistFamily();
  };
}

function renderAddInfoForm(wrap, type, personId) {
  const form = document.createElement("div"); form.className = "add-form";
  if (type === "location") {
    form.innerHTML = `
      <div class="form-title">Añadir ubicación</div>
      <label>Desde qué año</label><input id="i-from" type="number" placeholder="p. ej. 2010" />
      <label>Ciudad</label><input id="i-city" placeholder="p. ej. Madrid" />
      <label>País</label><input id="i-country" placeholder="p. ej. España" />
      <label>Latitud</label><input id="i-lat" type="number" step="any" placeholder="p. ej. 40.4168" />
      <label>Longitud</label><input id="i-lng" type="number" step="any" placeholder="p. ej. -3.7038" />
      <div class="hint">Busca "coordenadas de [ciudad]" en Google para obtener lat/lng</div>
      <div class="actions"><button class="btn btn-secondary" id="i-cancel">Cancelar</button><button class="btn btn-primary" id="i-submit">Añadir</button></div>`;
  } else {
    form.innerHTML = `
      <div class="form-title">Añadir actividad</div>
      <label>Desde qué año</label><input id="i-from" type="number" placeholder="p. ej. 2015" />
      <label>Actividad</label><input id="i-label" placeholder="p. ej. Ingeniero, Estudiante…" />
      <div class="actions"><button class="btn btn-secondary" id="i-cancel">Cancelar</button><button class="btn btn-primary" id="i-submit">Añadir</button></div>`;
  }
  wrap.appendChild(form);
  form.querySelector("#i-cancel").onclick = () => setState({ addingInfo: null });
  form.querySelector("#i-submit").onclick = () => {
    const from = parseInt(form.querySelector("#i-from").value);
    if (!from) return;
    const updatedPeople = state.family.people.map((p) => {
      if (p.id !== personId) return p;
      if (type === "location") {
        const city = form.querySelector("#i-city").value.trim();
        const country = form.querySelector("#i-country").value.trim();
        const lat = parseFloat(form.querySelector("#i-lat").value) || 0;
        const lng = parseFloat(form.querySelector("#i-lng").value) || 0;
        return { ...p, locations: [...(p.locations || []), { from, city, country, lat, lng }].sort((a, b) => a.from - b.from) };
      } else {
        const label = form.querySelector("#i-label").value.trim();
        return { ...p, activities: [...(p.activities || []), { from, label }].sort((a, b) => a.from - b.from) };
      }
    });
    const updatedFamily = { ...state.family, people: updatedPeople };
    setState({ family: updatedFamily, addingInfo: null });
    persistFamily();
  };
}

// ================================ Init =====================================
(async function init() {
  const savedCode = localStorage.getItem("lf_code");
  if (!savedCode) { setState({ phase: "entry" }); return; }
  try {
    const family = await fetchFamily(savedCode);
    if (!family) { setState({ phase: "entry" }); return; }
    // Migrar datos antiguos
    if (!family.events) family.events = [];
    family.people.forEach((p) => { if (!p.locations) p.locations = []; if (!p.activities) p.activities = []; if (!p.birthYear) p.birthYear = null; if (!p.deathYear) p.deathYear = null; });
    const savedMe = localStorage.getItem("lf_me");
    if (savedMe && byId(family.people, savedMe)) setState({ phase: "main", code: savedCode, family, meId: savedMe, selectedYear: new Date().getFullYear() });
    else setState({ phase: "who", code: savedCode, family });
  } catch (err) {
    setState({ phase: "entry" });
  }
})();
