// ============================================================================
// Línea familiar — app.js
// Vanilla JS + Supabase. Cada familia es una única fila en la tabla
// `families` (columna `data` en formato jsonb con { name, people, couples }).
// Ver supabase-schema.sql para crear la tabla y las políticas de acceso.
// ============================================================================

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const el = document.getElementById("app");

// ------------------------------- Estado --------------------------------
let state = { phase: "loading", code: null, family: null, meId: null };

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

// ---------------------------- Utilidades de datos ------------------------
const byId = (people, id) => people.find((p) => p.id === id);
const childrenOf = (people, id) => people.filter((p) => p.parentIds.includes(id));
const partnershipsOf = (couples, id) =>
  couples.filter((cp) => cp.a === id || cp.b === id).map((cp) => ({ partnerId: cp.a === id ? cp.b : cp.a, ex: cp.ex }));
const partnerIdsOf = (couples, id) => partnershipsOf(couples, id).map((p) => p.partnerId);

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

// ------------------------- Cálculo de parentesco --------------------------
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
  suegro: ["suegro", "suegra"], padrastro: ["padrastro", "madrastra"], expareja: ["expareja", "expareja"],
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
const POLITICAL = { hermano: "cunado", hijo: "yerno", padre: "padrastro", tio: "tio", primo: "primo", sobrino: "sobrino", abuelo: "abuelo", nieto: "nieto" };

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

// -------------------------------- Supabase --------------------------------
const familyCodeKey = (code) => code.trim().toLowerCase();

async function fetchFamily(code) {
  const { data, error } = await supabase.from("families").select("data").eq("code", familyCodeKey(code)).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
async function insertFamily(code, family) {
  const { error } = await supabase.from("families").insert({ code: familyCodeKey(code), data: family });
  if (error) throw error;
}
async function saveFamily(code, family) {
  const { error } = await supabase.from("families").update({ data: family }).eq("code", familyCodeKey(code));
  if (error) throw error;
}

// ---------------------------------- Render ---------------------------------
function render() {
  el.className = state.phase === "tree" ? "tree-active" : "";
  el.innerHTML = "";
  if (state.phase === "loading") return renderLoading();
  if (state.phase === "entry") return renderEntry();
  if (state.phase === "create") return renderCreate();
  if (state.phase === "join") return renderJoin();
  if (state.phase === "who") return renderWho();
  if (state.phase === "tree") return renderTree();
}

function renderLoading() {
  el.innerHTML = `<div class="loading">Cargando…</div>`;
}

function renderEntry() {
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <div class="title">Línea familiar</div>
    <div class="subtitle">Un árbol y una historia, solo para los tuyos</div>
    <button class="btn btn-primary" id="btn-create" style="margin-bottom:10px">Crear una familia nueva</button>
    <button class="btn btn-secondary" id="btn-join">Ya tengo un código</button>
  `;
  el.appendChild(wrap);
  wrap.querySelector("#btn-create").onclick = () => setState({ phase: "create" });
  wrap.querySelector("#btn-join").onclick = () => setState({ phase: "join" });
}

function renderCreate() {
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <button class="btn-back" id="btn-back">← Volver</button>
    <div class="title" style="font-size:20px;margin-bottom:18px">Crear una familia</div>
    <label>Nombre de la familia</label>
    <input id="f-name" placeholder="p. ej. Familia Páez" />
    <label>Tu nombre</label>
    <input id="f-you" placeholder="Tu nombre" />
    <div class="gender-toggle">
      <button type="button" data-g="F" class="active">Mujer</button>
      <button type="button" data-g="M">Hombre</button>
    </div>
    <label>Código de acceso (compártelo con tu familia)</label>
    <input id="f-code" placeholder="p. ej. paez2024" />
    <div class="hint">Quien tenga este código podrá entrar y añadirse al árbol</div>
    <div class="error-text" id="f-error" style="display:none"></div>
    <button class="btn btn-primary" id="f-submit">Crear familia</button>
  `;
  el.appendChild(wrap);
  wrap.querySelector("#btn-back").onclick = () => setState({ phase: "entry" });

  let gender = "F";
  wrap.querySelectorAll(".gender-toggle button").forEach((b) => {
    b.onclick = () => { gender = b.dataset.g; wrap.querySelectorAll(".gender-toggle button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); };
  });

  const errorEl = wrap.querySelector("#f-error");
  const submitBtn = wrap.querySelector("#f-submit");
  submitBtn.onclick = async () => {
    const familyName = wrap.querySelector("#f-name").value.trim();
    const yourName = wrap.querySelector("#f-you").value.trim();
    const code = wrap.querySelector("#f-code").value.trim();
    if (!familyName || !yourName || !code) { errorEl.textContent = "Rellena los tres campos"; errorEl.style.display = "block"; return; }
    submitBtn.disabled = true; submitBtn.textContent = "Creando…"; errorEl.style.display = "none";
    try {
      const existing = await fetchFamily(code);
      if (existing) { errorEl.textContent = "Ya existe una familia con ese código, elige otro"; errorEl.style.display = "block"; submitBtn.disabled = false; submitBtn.textContent = "Crear familia"; return; }
      const me = { id: "p1", name: yourName, gender, parentIds: [] };
      const family = { name: familyName, people: [me], couples: [] };
      await insertFamily(code, family);
      localStorage.setItem("lf_code", familyCodeKey(code));
      localStorage.setItem("lf_me", me.id);
      setState({ phase: "tree", code: familyCodeKey(code), family, meId: me.id });
    } catch (err) {
      errorEl.textContent = "No se ha podido crear la familia. Revisa la configuración de Supabase en config.js.";
      errorEl.style.display = "block";
      submitBtn.disabled = false; submitBtn.textContent = "Crear familia";
    }
  };
}

function renderJoin() {
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <button class="btn-back" id="btn-back">← Volver</button>
    <div class="title" style="font-size:20px;margin-bottom:6px">Entrar con código</div>
    <div class="subtitle">Pide el código a quien creó vuestra familia</div>
    <input id="j-code" placeholder="Código de familia" style="text-align:center" />
    <div class="error-text" id="j-error" style="display:none"></div>
    <button class="btn btn-primary" id="j-submit">Entrar</button>
  `;
  el.appendChild(wrap);
  wrap.querySelector("#btn-back").onclick = () => setState({ phase: "entry" });

  const errorEl = wrap.querySelector("#j-error");
  const submitBtn = wrap.querySelector("#j-submit");
  submitBtn.onclick = async () => {
    const code = wrap.querySelector("#j-code").value.trim();
    if (!code) return;
    submitBtn.disabled = true; submitBtn.textContent = "Entrando…"; errorEl.style.display = "none";
    try {
      const family = await fetchFamily(code);
      if (!family) { errorEl.textContent = "No existe ninguna familia con ese código"; errorEl.style.display = "block"; submitBtn.disabled = false; submitBtn.textContent = "Entrar"; return; }
      localStorage.setItem("lf_code", familyCodeKey(code));
      setState({ phase: "who", code: familyCodeKey(code), family });
    } catch (err) {
      errorEl.textContent = "No se ha podido entrar. Revisa la configuración de Supabase en config.js.";
      errorEl.style.display = "block";
      submitBtn.disabled = false; submitBtn.textContent = "Entrar";
    }
  };
}

function renderWho() {
  const wrap = document.createElement("div");
  wrap.className = "panel wide";
  wrap.style.maxWidth = "420px";
  wrap.innerHTML = `
    <div class="title" style="font-size:20px;margin-bottom:4px">¿Quién eres tú?</div>
    <div class="subtitle">Así te mostramos el parentesco de cada persona relativo a ti, en ${state.family.name}</div>
    <input id="w-search" placeholder="Buscar tu nombre…" />
    <div class="people-grid" id="w-grid"></div>
  `;
  el.appendChild(wrap);

  function renderGrid(q) {
    const grid = wrap.querySelector("#w-grid");
    const list = state.family.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    grid.innerHTML = list.length
      ? list.map((p) => `<button class="person-chip" data-id="${p.id}"><span class="avatar">${p.name.charAt(0)}</span>${p.name}</button>`).join("")
      : `<div class="empty-note">Nadie con ese nombre todavía.</div>`;
    grid.querySelectorAll(".person-chip").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        localStorage.setItem("lf_me", id);
        setState({ phase: "tree", meId: id });
      };
    });
  }
  renderGrid("");
  wrap.querySelector("#w-search").oninput = (e) => renderGrid(e.target.value);
}

// ------------------------------- Añadir familiar ---------------------------
const RELATION_TYPES = [
  { id: "hijo", label: "Es hijo/a de" },
  { id: "padre", label: "Es padre/madre de" },
  { id: "pareja", label: "Es pareja de" },
  { id: "hermano", label: "Es hermano/a de" },
];

function renderAddForm(container) {
  const { people } = state.family;
  const form = document.createElement("div");
  form.className = "add-form";
  form.innerHTML = `
    <div class="form-title">Añadir familiar</div>
    <input id="a-name" placeholder="Nombre" />
    <div class="gender-toggle">
      <button type="button" data-g="F" class="active">Mujer</button>
      <button type="button" data-g="M">Hombre</button>
    </div>
    <select id="a-type">${RELATION_TYPES.map((r) => `<option value="${r.id}">${r.label}</option>`).join("")}</select>
    <select id="a-to">${people.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
    <select id="a-to2" style="display:none">
      <option value="">(el otro progenitor no está en el árbol / no aplica)</option>
      ${people.map((p) => `<option value="${p.id}">y de ${p.name}</option>`).join("")}
    </select>
    <div class="error-text" id="a-error" style="display:none"></div>
    <div class="actions">
      <button class="btn btn-secondary" id="a-cancel">Cancelar</button>
      <button class="btn btn-primary" id="a-submit">Añadir</button>
    </div>
  `;
  container.appendChild(form);

  let gender = "F";
  form.querySelectorAll(".gender-toggle button").forEach((b) => {
    b.onclick = () => { gender = b.dataset.g; form.querySelectorAll(".gender-toggle button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); };
  });
  const typeSel = form.querySelector("#a-type");
  const to2Sel = form.querySelector("#a-to2");
  typeSel.onchange = () => { to2Sel.style.display = typeSel.value === "hijo" ? "block" : "none"; };

  form.querySelector("#a-cancel").onclick = () => renderTree();

  form.querySelector("#a-submit").onclick = async () => {
    const errorEl = form.querySelector("#a-error");
    const name = form.querySelector("#a-name").value.trim();
    const relType = typeSel.value;
    const relTo = form.querySelector("#a-to").value;
    const relTo2 = to2Sel.value;
    if (!name) { errorEl.textContent = "Ponle un nombre"; errorEl.style.display = "block"; return; }
    if (!relTo) { errorEl.textContent = "Elige con quién se relaciona"; errorEl.style.display = "block"; return; }

    const id = "p" + Math.random().toString(36).slice(2, 9);
    const person = { id, name, gender, parentIds: [] };
    let newCouples = [];
    let patchedPeople = [];

    if (relType === "hijo") {
      person.parentIds = relTo2 ? [relTo, relTo2] : [relTo];
      if (relTo2) newCouples.push({ a: relTo, b: relTo2, ex: false });
    } else if (relType === "padre") {
      const child = byId(people, relTo);
      if (child.parentIds.length >= 2) { errorEl.textContent = `${child.name} ya tiene dos progenitores`; errorEl.style.display = "block"; return; }
      const otherParent = child.parentIds[0];
      patchedPeople.push({ id: child.id, parentIds: [...child.parentIds, id] });
      if (otherParent) newCouples.push({ a: otherParent, b: id, ex: false });
    } else if (relType === "pareja") {
      newCouples.push({ a: relTo, b: id, ex: false });
    } else if (relType === "hermano") {
      const sibling = byId(people, relTo);
      person.parentIds = [...sibling.parentIds];
    }

    const updatedPeople = people
      .map((p) => { const patch = patchedPeople.find((pp) => pp.id === p.id); return patch ? { ...p, ...patch } : p; })
      .concat([person]);
    const updatedFamily = { ...state.family, people: updatedPeople, couples: [...state.family.couples, ...newCouples] };
    setState({ family: updatedFamily });
    saveFamily(state.code, updatedFamily).catch(() => {});
  };
}

// ---------------------------------- Árbol -----------------------------------
function renderTree() {
  const { people, couples, name } = state.family;
  const meId = state.meId;
  let openId = null;
  let addingOpen = false;

  const wrap = document.createElement("div");
  wrap.className = "panel wide";
  el.appendChild(wrap);

  function draw() {
    wrap.innerHTML = "";
    const me = byId(people, meId);

    const header = document.createElement("div");
    header.className = "tree-header";
    header.innerHTML = `
      <div><div class="title">${name}</div><div class="subtitle">Viendo como ${me.name}</div></div>
      <div class="tree-actions">
        <button class="small-btn" id="btn-change">Cambiar</button>
        <button class="btn-link" id="btn-leave">Salir</button>
      </div>
    `;
    wrap.appendChild(header);
    header.querySelector("#btn-change").onclick = () => setState({ phase: "who" });
    header.querySelector("#btn-leave").onclick = () => {
      localStorage.removeItem("lf_code"); localStorage.removeItem("lf_me");
      setState({ phase: "entry", code: null, family: null, meId: null });
    };

    const addWrap = document.createElement("div");
    addWrap.className = "add-toggle-wrap";
    addWrap.innerHTML = `<button class="small-btn" style="background:var(--brass);color:var(--card);font-weight:600;padding:8px 14px;font-size:12.5px" id="btn-add">${addingOpen ? "Cerrar" : "+ Añadir familiar"}</button>`;
    wrap.appendChild(addWrap);
    addWrap.querySelector("#btn-add").onclick = () => { addingOpen = !addingOpen; draw(); };
    if (addingOpen) renderAddForm(wrap);

    if (openId) {
      const open = byId(people, openId);
      const detail = document.createElement("div");
      detail.className = "detail-card";
      detail.innerHTML = `<div class="name">${open.name}</div><div class="rel">${open.id === meId ? "Eres tú" : `Es tu ${relationLabel(people, couples, meId, open.id).toLowerCase()}`}</div>`;
      wrap.appendChild(detail);
    }

    const scroll = document.createElement("div");
    scroll.className = "tree-scroll";
    const canvas = document.createElement("div");
    canvas.className = "tree-canvas";
    scroll.appendChild(canvas);
    wrap.appendChild(scroll);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    canvas.appendChild(svg);

    const nodeEls = {};
    const visited = new Set();
    trueRootIds(people, couples).forEach((rid) => canvas.appendChild(buildUnit(rid, people, couples, meId, nodeEls, visited, (id) => { openId = id; draw(); })));

    requestAnimationFrame(() => {
      const cRect = canvas.getBoundingClientRect();
      let paths = "";
      people.forEach((p) => {
        if (p.parentIds.length === 0) return;
        const childEl = nodeEls[p.id];
        if (!childEl) return;
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
  draw();
}

function buildUnit(id, people, couples, meId, nodeEls, visited, onOpen) {
  if (visited.has(id)) return document.createDocumentFragment();
  visited.add(id);
  const person = byId(people, id);
  const groups = groupsFor(people, couples, id);
  const entries = Object.entries(groups);
  if (entries.length === 0) return buildCard(person, people, couples, meId, nodeEls, onOpen);

  const row = document.createElement("div");
  row.className = "tree-unit-row";
  entries.forEach(([otherId, { kids, ex }]) => {
    const partner = otherId !== "__solo__" ? byId(people, otherId) : null;
    if (partner) visited.add(partner.id);
    const group = document.createElement("div");
    group.className = "tree-group";
    const couple = document.createElement("div");
    couple.className = "tree-couple";
    couple.appendChild(buildCard(person, people, couples, meId, nodeEls, onOpen));
    if (partner) {
      const conn = document.createElement("div");
      conn.className = "tree-connector" + (ex ? " ex" : "");
      couple.appendChild(conn);
      couple.appendChild(buildCard(partner, people, couples, meId, nodeEls, onOpen));
    }
    group.appendChild(couple);
    if (kids.length > 0) {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "tree-children";
      kids.forEach((k) => childrenWrap.appendChild(buildUnit(k.id, people, couples, meId, nodeEls, visited, onOpen)));
      group.appendChild(childrenWrap);
    }
    row.appendChild(group);
  });
  return row;
}

function buildCard(p, people, couples, meId, nodeEls, onOpen) {
  const isYou = p.id === meId;
  const btn = document.createElement("button");
  btn.className = "card" + (isYou ? " you" : "");
  btn.innerHTML = `
    <div class="avatar-lg">${p.name.charAt(0)}</div>
    <div class="cname">${p.name}</div>
    <div class="crel">${isYou ? "tú" : relationLabel(people, couples, meId, p.id)}</div>
  `;
  btn.onclick = () => onOpen(p.id);
  nodeEls[p.id] = btn;
  return btn;
}

// ------------------------------------ Init ----------------------------------
(async function init() {
  const savedCode = localStorage.getItem("lf_code");
  if (!savedCode) { setState({ phase: "entry" }); return; }
  try {
    const family = await fetchFamily(savedCode);
    if (!family) { setState({ phase: "entry" }); return; }
    const savedMe = localStorage.getItem("lf_me");
    if (savedMe && byId(family.people, savedMe)) setState({ phase: "tree", code: savedCode, family, meId: savedMe });
    else setState({ phase: "who", code: savedCode, family });
  } catch (err) {
    setState({ phase: "entry" });
  }
})();
