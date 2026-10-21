window.startClient = function (ctx) {
  if (ctx.config) Object.assign(CLIENT, ctx.config);
  const C = CLIENT;
  C.features = C.features || {};
  const F = C.features;

  const S = { days: {}, lifts: {} };
  (ctx.logs || []).forEach(r => {
    S.days[r.log_date] = Object.assign({ meals: [], water: 0 }, r.day || {});
    S.lifts[r.log_date] = r.lifts || {};
  });

  const dirty = new Set();
  let timer;
  const setStatus = t => { const el = document.getElementById("sync"); if (el) el.textContent = t; };
  async function flush() {
    const ks = [...dirty]; dirty.clear();
    try {
      for (const k of ks) {
        const { error } = await ctx.sb.from("day_logs").upsert({ user_id: ctx.userId, log_date: k, day: S.days[k] || {}, lifts: S.lifts[k] || {}, updated_at: new Date().toISOString() });
        if (error) throw error;
      }
      setStatus("Saved");
    } catch (e) {
      ks.forEach(k => dirty.add(k));
      setStatus("Not saved. Check your connection.");
      clearTimeout(timer); timer = setTimeout(flush, 5000);
    }
  }
  window.addEventListener("offline", () => setStatus("Offline. Your changes will save when you're back online."));
  window.addEventListener("online", () => { setStatus("Back online. Saving..."); flush(); });
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); window.__bip = e; if (typeof render === "function" && tab === "home") render(); });
  const save = k => { if (ctx.readOnly) return; dirty.add(k || date); setStatus("Saving..."); clearTimeout(timer); timer = setTimeout(flush, 600); };

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const toDate = k => new Date(k + "T12:00:00");
  const realToday = iso(new Date());
  let date = realToday;
  let tab = "home";

  // Installed apps stay open in memory for days. Reload when the app comes back after a long break or a new day,
  // so "today" is right and the coach's latest plan changes show up.
  const loadedAt = Date.now(), loadedDay = realToday;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (iso(new Date()) === loadedDay && Date.now() - loadedAt < 30 * 60 * 1000) return;
    Promise.resolve(flush()).then(() => { if (!dirty.size) location.reload(); });
  });

  const dayRec = k => { if (!S.days[k]) S.days[k] = { meals: [], water: 0 }; return S.days[k]; };
  const scheduled = k => C.schedule[toDate(k).getDay()];
  // Rotation mode (config `rotation: true`): the suggested session is the next one in the cycle after the last
  // session actually logged, so skipping a day pushes the order back instead of losing a session.
  const cycleOf = () => [1, 2, 3, 4, 5, 6, 0].map(i => C.schedule[i]).filter(x => x && x !== "Rest");
  const dayLifted = k => Object.keys(S.lifts[k] || {}).some(ex => loggedSets(k, ex).length > 0);
  function rotDefault(k) {
    const cyc = cycleOf(), n = cyc.length;
    if (!n) return scheduled(k);
    let p = 0;
    const logged = [...new Set(Object.keys(S.days).concat(Object.keys(S.lifts)))].filter(j => j < k).sort();
    logged.forEach(j => {
      const ex = S.days[j] && S.days[j].workout;
      const sess = ex || (scheduled(j) === "Rest" ? "Rest" : cyc[p]);
      if (sess === "Rest" || !(ex || dayLifted(j))) return;
      if (cyc[p] === sess) p = (p + 1) % n;
      else for (let s = 1; s < n; s++) if (cyc[(p + s) % n] === sess) { p = (p + s + 1) % n; break; }
    });
    return scheduled(k) === "Rest" ? "Rest" : cyc[p];
  }
  const workoutFor = k => (S.days[k] && S.days[k].workout) || (C.rotation ? rotDefault(k) : scheduled(k));
  const peek = k => S.days[k] || { meals: [], water: 0 };

  const weekNum = () => Math.min(C.totalWeeks, Math.max(1, Math.floor((toDate(date) - toDate(C.startDate)) / 864e5 / 7) + 1));

  const weights = () => {
    const m = {};
    C.weightLog.forEach(x => { m[x.date] = x.w; });
    Object.keys(S.days).forEach(k => { if (S.days[k].weight) m[k] = S.days[k].weight; });
    return Object.keys(m).sort().map(k => ({ date: k, w: m[k] }));
  };
  const latestWeight = () => { const w = weights(); return w.length ? w[w.length - 1].w : C.startWeight; };

  const checkinDone = d => !!(d && d.checkin && d.checkin.n && d.checkin.i && d.checkin.s);
  const loggedSets = (k, ex) => ((S.lifts[k] || {})[ex] || []).filter(s => s && s.r);
  const workoutDone = (k, name) => (C.workouts[name] || []).every(ex => loggedSets(k, ex).length > 0);

  const SLEEP_STREAK_FROM = "2026-10-20";
  function tasks(k) {
    const d = peek(k);
    const t = [
      C.meals.length ? { label: "Meals", done: C.meals.every((_, i) => d.meals[i]) } : { label: "Food log", done: (d.foods || []).length > 0 },
      { label: "Weigh-in", done: !!d.weight },
      { label: "Water", done: (d.water || 0) >= C.targets.water },
      { label: "Steps", done: !!d.steps },
      { label: "Check-in", done: checkinDone(d) }
    ];
    // Sleep counts toward the streak from this date on, so nobody's earlier streak is affected.
    if (F.sleepLog !== false && k >= SLEEP_STREAK_FROM) t.splice(4, 0, { label: "Sleep", done: !!d.sleepHrs });
    const wk = workoutFor(k);
    if (wk !== "Rest") t.push({ label: wk, done: workoutDone(k, wk) });
    return t;
  }

  function streak() {
    let n = 0;
    const d = toDate(realToday);
    if (!checkinDone(S.days[iso(d)])) d.setDate(d.getDate() - 1);
    while (checkinDone(S.days[iso(d)])) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  const niceDate = k => toDate(k).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  /* ---------- shared pieces ---------- */
  const DAY_TABS = ["home", "training", "nutrition", "meals"];
  let checkinOpen = false;
  let pwMsg = "", pwOk = false;
  let photoMsg = "";
  let swapOpen = {};
  let msgs = (ctx.messages || []).slice();
  const unreadCoach = () => msgs.filter(m => m.sender === "coach" && !m.read).length;
  function updateDot() { const b = document.querySelector('#tabs [data-tab="notes"]'); if (b) b.classList.toggle("has-dot", unreadCoach() > 0); }
  async function refreshMsgs() {
    const { data } = await ctx.sb.from("messages").select("id,sender,body,created_at,read").eq("client_id", ctx.userId).order("created_at", { ascending: true });
    if (data) msgs = data;
    updateDot();
  }
  async function markRead() {
    if (ctx.readOnly) return;
    const ids = msgs.filter(m => m.sender === "coach" && !m.read).map(m => m.id);
    if (!ids.length) return;
    await ctx.sb.from("messages").update({ read: true }).in("id", ids);
    msgs.forEach(m => { if (ids.includes(m.id)) m.read = true; });
    updateDot();
  }
  async function sendMsg() {
    const ta = document.getElementById("msgbox");
    const body = ((ta && ta.value) || "").trim();
    if (!body) return;
    const { data, error } = await ctx.sb.from("messages").insert({ client_id: ctx.userId, sender: "client", body }).select("id,sender,body,created_at,read").single();
    if (error) { msgNote = "Could not send. Try again."; } else { msgs.push(data); msgNote = "Sent."; }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  let msgNote = "";
  const photoUrls = {};
  const BUCKET = "progress-photos";

  async function hydratePhotos() {
    const imgs = [...document.querySelectorAll("img[data-ph]")];
    const need = [...new Set(imgs.map(i => i.dataset.ph).filter(p => !photoUrls[p]))];
    if (need.length) {
      const { data } = await ctx.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
      (data || []).forEach(x => { if (x.signedUrl) photoUrls[x.path] = x.signedUrl; });
    }
    imgs.forEach(i => { const u = photoUrls[i.dataset.ph]; if (u) { i.src = u; const a = i.closest("a"); if (a) a.href = u; } });
  }

  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error("Could not read that photo.")), "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that photo.")); };
      img.src = url;
    });
  }

  async function uploadPhoto(file, angle) {
    photoMsg = "Uploading " + angle + " photo...";
    render();
    try {
      const blob = await resizeImage(file, 1280);
      const path = `${ctx.userId}/${realToday}/${angle}-${Date.now()}.jpg`;
      const { error } = await ctx.sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const d = dayRec(realToday);
      d.photos = (d.photos || []).concat({ a: angle, p: path });
      save(realToday);
      photoMsg = "Added your " + angle + " photo.";
    } catch (e) {
      photoMsg = "Could not upload: " + (e.message || "try again.");
    }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }

  async function deletePhoto(k, path) {
    const { error } = await ctx.sb.storage.from(BUCKET).remove([path]);
    if (error) { photoMsg = "Could not delete: " + error.message; }
    else { const d = dayRec(k); d.photos = (d.photos || []).filter(x => x.p !== path); save(k); photoMsg = "Photo deleted."; }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }

  function photosSection() {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const days = Object.keys(S.days).filter(k => (S.days[k].photos || []).length).sort().reverse();
    let h = `<h2>Progress photos</h2>`;
    if (!ctx.readOnly) {
      h += `<div class="card"><h3>Add today's photos</h3><div class="muted small">Front, side and back. Same spot, same lighting.</div>
        <div class="btns">${["front", "side", "back"].map(a => `<label class="btn ghost">${cap(a)}<input type="file" accept="image/*" data-ph-angle="${a}" hidden></label>`).join("")}</div>
        ${photoMsg ? `<div class="muted small" style="margin-top:8px">${esc(photoMsg)}</div>` : ""}</div>`;
    }
    if (!days.length) return h + `<div class="card muted">Your photos will show up here.</div>`;
    if (days.length >= 2) {
      const pick = k => (S.days[k].photos.find(p => p.a === "front") || S.days[k].photos[0]);
      const first = days[days.length - 1], latest = days[0], p1 = pick(first), p2 = pick(latest);
      const lab = k => toDate(k).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      h += `<div class="card"><h3 style="color:var(--ink)">Then and now</h3><div class="photogrid" style="grid-template-columns:1fr 1fr">
        <div class="ph"><img data-ph="${esc(p1.p)}" alt="Earliest photo"><div class="phl"><span>${lab(first)}</span></div></div>
        <div class="ph"><img data-ph="${esc(p2.p)}" alt="Latest photo"><div class="phl"><span>${lab(latest)}</span></div></div></div></div>`;
    }
    return h + days.map(k => `<div class="card"><h3 style="color:var(--ink)">${k === realToday ? "Today" : toDate(k).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</h3>
      <div class="photogrid">${S.days[k].photos.map(p => `<div class="ph"><a target="_blank" rel="noopener"><img data-ph="${esc(p.p)}" alt="${esc(p.a)} photo, ${k}"></a>
        <div class="phl"><span>${esc(p.a)}</span>${ctx.readOnly ? "" : `<button class="x" data-act="delphoto" data-d="${k}" data-p="${esc(p.p)}" aria-label="Delete photo">&times;</button>`}</div></div>`).join("")}</div></div>`).join("");
  }

  const brandRow = `<div class="brandrow"><picture class="brandmark"><source media="(prefers-color-scheme: dark)" srcset="logo-wordmark-dark.png?v=38"><img src="logo-wordmark-light.png?v=38" alt="Awwab Fitness"></picture></div>`;
  function header(title, sub, back) {
    const isToday = date === realToday;
    if (back) return brandRow + `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div><button class="btn ghost" data-go="home">Back</button></div>`;
    if (!DAY_TABS.includes(tab)) return brandRow + `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div></div>`;
    return brandRow + `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div>
      <div class="datenav"><button data-act="prev" aria-label="Previous day">&lsaquo;</button><button data-act="next" aria-label="Next day" ${isToday ? "disabled" : ""}>&rsaquo;</button></div></div>`;
  }

  function mealVariant(m, i, d) {
    const v = (d.mv || {})[i];
    if (v === "c") { const c = (d.custom || {})[i] || {}; return { custom: true, label: "Something else", items: [c.note || "Something else"], p: +c.p || 0, f: +c.f || 0, c: +c.c || 0, cal: +c.cal || 0 }; }
    if (v >= 1 && m.swaps && m.swaps[v - 1]) { const s = m.swaps[v - 1]; return { label: s.name, items: s.items || [], p: +s.p || 0, f: +s.f || 0, c: +s.c || 0, cal: +s.cal || 0 }; }
    return { label: "", items: m.items, p: m.p, f: m.f, c: m.c, cal: m.cal };
  }
  const consumed = d => (d.foods || []).reduce((a, x) => ({ p: a.p + (+x.p || 0), f: a.f + (+x.f || 0), c: a.c + (+x.c || 0), cal: a.cal + (+x.cal || 0) }),
    C.meals.reduce((a, m, i) => { if (!d.meals[i]) return a; const v = mealVariant(m, i, d); return { p: a.p + v.p, f: a.f + v.f, c: a.c + v.c, cal: a.cal + v.cal }; }, { p: 0, f: 0, c: 0, cal: 0 }));

  /* ---------- food search & logging ---------- */
  const OZ = 28.3495;
  const fs = { q: "", off: [], offMsg: "", busy: false, sel: null, unit: "g", amt: "", manual: false, man: {}, slot: null, open: false, tab: "search", focus: false };
  const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
  const slotNow = () => { const h = new Date().getHours(); return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 21 ? "Dinner" : "Snack"; };
  const curSlot = () => fs.slot || slotNow();
  let saved = null, savedNote = "";
  async function loadSaved() {
    if (ctx.readOnly || saved) return;
    saved = [];
    try {
      const { data, error } = await ctx.sb.from("saved_meals").select("id,name,cal,p,f,c").eq("user_id", ctx.userId).order("created_at", { ascending: false });
      if (error) throw error;
      saved = data || [];
      if ((tab === "meals") && saved.length) { const y = window.scrollY; render(); window.scrollTo(0, y); }
    } catch (e) { saved = []; }
  }
  function savedPanel() {
    if (ctx.readOnly || !saved || !saved.length) return savedNote ? `<div class="muted small" style="margin-top:8px">${esc(savedNote)}</div>` : "";
    return `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><label class="field">Your saved meals</label>` + saved.slice(0, 10).map(m =>
      `<div class="rowline" style="padding:6px 0"><button class="opt" style="margin:0 8px 0 0;flex:1" data-act="sadd" data-id="${m.id}"><strong>${esc(m.name)}</strong><span class="muted small"> ${Math.round(m.cal)} cal, P ${r1(m.p)} / F ${r1(m.f)} / C ${r1(m.c)}</span></button><button class="linkbtn" data-act="sdel" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">Delete</button></div>`).join("") +
      (savedNote ? `<div class="muted small">${esc(savedNote)}</div>` : "") + `</div>`;
  }
  const r1 = v => Math.round(v * 10) / 10;
  function localFoods(q) {
    const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!words.length) return [];
    return (window.FOODS || []).filter(f => words.every(w => f.n.toLowerCase().includes(w)))
      .sort((a, b) => (b.n.toLowerCase().startsWith(words[0]) ? 1 : 0) - (a.n.toLowerCase().startsWith(words[0]) ? 1 : 0)).slice(0, 8);
  }
  const foodRow = (f, src, i) => `<button class="opt" data-act="fpick" data-src="${src}" data-i="${i}"><strong>${esc(f.n)}</strong><span class="muted small"> ${Math.round(f.k)} cal, P ${r1(f.p)} / F ${r1(f.f)} / C ${r1(f.c)} per 100 g</span></button>`;
  function foodResults() {
    if (!fs.q.trim()) return fs.sel ? "" : `<div class="muted" style="padding:8px 0">Type a food above, or tap Scan to read a barcode.</div>`;
    const loc = localFoods(fs.q);
    let h = loc.map((f, i) => foodRow(f, "l", i)).join("");
    h += fs.off.map((f, i) => foodRow(f, "o", i)).join("");
    if (!loc.length && !fs.off.length && !fs.busy) h += `<div class="muted small" style="margin-bottom:8px">Not in the common list.</div>`;
    h += fs.busy ? `<div class="muted small">Searching the food database...</div>` : `<button class="linkbtn" data-act="foff">Search more foods and brands</button>`;
    if (fs.offMsg) h += `<div class="muted small">${esc(fs.offMsg)}</div>`;
    return h;
  }
  function recentFoods(max) {
    const seen = new Set(), out = [];
    Object.keys(S.days).filter(k => k <= date).sort().reverse().forEach(k => (S.days[k].foods || []).slice().reverse().forEach(x => {
      const key = x.n + "|" + x.cal; if (!seen.has(key) && out.length < (max || 6)) { seen.add(key); out.push(x); }
    }));
    return out;
  }
  function yesterdayFoods() {
    const x = toDate(date); x.setDate(x.getDate() - 1);
    return (S.days[iso(x)] || {}).foods || [];
  }
  function quickAdd() {
    if (ctx.readOnly) return `<div class="muted small">Type a food, then tap it and enter how much you ate.</div>`;
    const y = yesterdayFoods(), r = recentFoods();
    let h = `<div class="muted small">Type a food, then tap it and enter how much you ate.</div>`;
    if (y.length) h += `<button class="opt" style="margin-top:10px" data-act="frepeat"><strong>Repeat yesterday's foods</strong><span class="muted small"> ${y.length} item${y.length > 1 ? "s" : ""}, ${y.reduce((a, f) => a + (+f.cal || 0), 0)} cal</span></button>`;
    if (r.length) h += `<label class="field" style="margin-top:12px">Recent</label><div class="chips">` + r.map((f, i) => `<button class="chipbtn" data-act="frecent" data-i="${i}">${esc(f.n.length > 26 ? f.n.slice(0, 25) + "..." : f.n)} <span class="muted small">${Math.round(f.cal)}</span></button>`).join("") + `</div>`;
    return h;
  }
  function foodUnits(f) { return [["g", 1], ["oz", OZ]].concat(f.u || []); }
  function foodCalc() {
    const f = fs.sel, amt = parseFloat(fs.amt);
    if (!f || !(amt > 0)) return null;
    const u = foodUnits(f).find(x => x[0] === fs.unit) || ["g", 1];
    const g = amt * u[1], k = g / 100;
    return { g: Math.round(g), cal: Math.round(f.k * k), p: r1(f.p * k), f: r1(f.f * k), c: r1(f.c * k) };
  }
  function foodPreview() {
    const x = foodCalc();
    return x ? `<strong>${x.cal} cal</strong> &middot; P ${x.p}g &middot; F ${x.f}g &middot; C ${x.c}g <span class="muted small">(${x.g} g)</span>` : `<span class="muted small">Enter an amount to see the numbers.</span>`;
  }
  function foodPanel() {
    const f = fs.sel;
    if (!f) return "";
    return `<div class="swappanel" style="margin:12px 0 0;border-top:1px solid var(--line);padding-top:12px"><h3 style="color:var(--ink)">${esc(f.n)}</h3>
      <div class="grid2"><div><label class="field" for="famt">Amount</label><input id="famt" type="number" inputmode="decimal" data-f="famt" value="${esc(fs.amt)}" placeholder="e.g. 150"></div>
      <div><label class="field" for="funit">Unit</label><select id="funit" data-f="funit">${foodUnits(f).map(x => `<option value="${esc(x[0])}" ${fs.unit === x[0] ? "selected" : ""}>${esc(x[0])}</option>`).join("")}</select></div></div>
      <div id="fprev" style="margin:10px 0">${foodPreview()}</div>
      <div class="btns">${ctx.readOnly ? `<div class="muted small" style="margin-right:8px;align-self:center">Preview only: adding is turned off.</div>` : `<button class="btn" data-act="fadd">Add to today</button>`}<button class="btn ghost" data-act="fcancel">Cancel</button></div></div>`;
  }
  const titleCase = t => String(t || "").toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  function manualPanel() {
    if (ctx.readOnly) return "";
    if (!fs.manual) return `<button class="linkbtn" data-act="fmopen">Enter calories and macros yourself</button>`;
    const m = fs.man, fld = (k, label, ph) => `<div><label class="field">${label}</label><input type="number" inputmode="decimal" data-f="fm" data-k="${k}" value="${esc(m[k] == null ? "" : m[k])}" placeholder="${ph || ""}"></div>`;
    return `<div class="swappanel" style="margin:12px 0 0;border-top:1px solid var(--line);padding-top:12px"><h3 style="color:var(--ink)">Enter it yourself</h3>
      <label class="field" for="fmn">What was it?</label><input id="fmn" type="text" data-f="fm" data-k="n" value="${esc(m.n || "")}" placeholder="e.g. Protein bar">
      <div class="grid2" style="margin-top:8px">${fld("cal", "Calories", "or leave blank")}${fld("p", "Protein (g)")}${fld("c", "Carbs (g)")}${fld("f", "Fat (g)")}</div>
      <div class="muted small" style="margin-top:6px">Copy these from the label. If you leave calories blank, they're worked out from the macros.</div>
      <div class="btns"><button class="btn" data-act="fmadd">Add to today</button><button class="btn ghost" data-act="fmclose">Cancel</button></div></div>`;
  }
  /* ---------- barcode scanner ---------- */
  const scan = { stream: null, stop: false, reader: null, el: null };
  function closeScanner() {
    scan.stop = true;
    try { if (scan.reader) scan.reader.reset(); } catch (e) {}
    try { if (scan.stream) scan.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    scan.stream = null; scan.reader = null;
    if (scan.el) { scan.el.remove(); scan.el = null; }
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function lookupBarcode(raw) {
    const code = String(raw || "").replace(/\D/g, "");
    if (code.length < 8) return "Enter the 8 to 13 digit number printed under the barcode.";
    try {
      const res = await fetch("https://world.openfoodfacts.org/api/v2/product/" + code + ".json?fields=product_name,brands,nutriments,serving_quantity,serving_size");
      const j = await res.json(), p = j.product;
      if (!p || j.status !== 1 || !p.nutriments || p.nutriments["energy-kcal_100g"] == null) return "That barcode isn't in the database. Try searching by name, or enter the numbers yourself.";
      const n = p.nutriments, sq = parseFloat(p.serving_quantity);
      const item = { n: (p.product_name || "Scanned food") + (p.brands ? " (" + p.brands.split(",")[0].trim() + ")" : ""), k: +n["energy-kcal_100g"] || 0, p: +n.proteins_100g || 0, f: +n.fat_100g || 0, c: +n.carbohydrates_100g || 0,
        u: sq > 0 ? [["serving" + (p.serving_size ? " (" + p.serving_size + ")" : ""), sq]] : [] };
      fs.sel = item; fs.manual = false; fs.q = ""; fs.open = true; fs.tab = "search";
      if (item.u.length) { fs.unit = item.u[0][0]; fs.amt = "1"; } else { fs.unit = "g"; fs.amt = ""; }
      return "";
    } catch (e) { return "Couldn't reach the food database. Check your connection and try again."; }
  }
  async function openScanner() {
    closeScanner(); scan.stop = false;
    const el = document.createElement("div"); el.className = "welcome"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Scan a barcode");
    el.innerHTML = `<div class="wcard"><h2 style="margin:0 0 10px">Scan a barcode</h2>
      <video id="scanvideo" playsinline muted autoplay style="width:100%;max-height:240px;border-radius:12px;background:#000"></video>
      <div class="muted small" id="scanmsg" style="margin:8px 0">Point the camera at the barcode on the package.</div>
      <label class="field" for="scancode">Or type the number under the barcode</label><input id="scancode" type="text" inputmode="numeric" placeholder="e.g. 722252100016">
      <div class="btns"><button class="btn" id="scango">Look up</button><button class="btn ghost" id="scanclose">Close</button></div></div>`;
    document.body.appendChild(el); scan.el = el;
    const msg = t => { const m = document.getElementById("scanmsg"); if (m) m.textContent = t; };
    const done = async code => {
      if (scan.stop) return; scan.stop = true; msg("Looking up " + code + "...");
      const err = await lookupBarcode(code);
      if (err) { scan.stop = false; msg(err); startCamera(); return; }
      closeScanner(); tab = "meals"; render(); window.scrollTo(0, 0);
    };
    document.getElementById("scanclose").onclick = closeScanner;
    document.getElementById("scango").onclick = () => done(document.getElementById("scancode").value);
    const startCamera = async () => {
      const video = document.getElementById("scanvideo"); if (!video) return;
      try {
        if (!scan.stream) { scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } }); video.srcObject = scan.stream; await video.play(); }
      } catch (e) { msg("The camera isn't available here. Type the barcode number instead."); video.style.display = "none"; return; }
      if ("BarcodeDetector" in window) {
        const det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        const loop = async () => { if (scan.stop || !scan.el) return; try { const r = await det.detect(video); if (r.length) { done(r[0].rawValue); return; } } catch (e) {} requestAnimationFrame(loop); };
        loop();
      } else {
        try {
          if (!window.ZXing) await loadScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js");
          if (!scan.reader) { scan.reader = new ZXing.BrowserMultiFormatReader(); scan.reader.decodeFromStream(scan.stream, video, res => { if (res && !scan.stop) done(res.getText()); }); }
        } catch (e) { msg("Scanning isn't supported on this phone. Type the barcode number instead."); }
      }
    };
    startCamera();
  }

  async function searchOff() {
    const q = fs.q.trim();
    if (!q || fs.busy) return;
    fs.busy = true; fs.offMsg = ""; refreshFood();
    try {
      const key = (typeof USDA_KEY !== "undefined" && USDA_KEY) || "DEMO_KEY";
      const url = "https://api.nal.usda.gov/fdc/v1/foods/search?pageSize=12&dataType=Foundation,SR%20Legacy,Branded&api_key=" + encodeURIComponent(key) + "&query=" + encodeURIComponent(q);
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(url, { signal: ctl.signal }); clearTimeout(to);
      if (res.status === 429) throw new Error("busy");
      const j = await res.json();
      fs.off = (j.foods || []).map(x => {
        const num = {}; (x.foodNutrients || []).forEach(n => { num[n.nutrientNumber] = +n.value; });
        const k = num["208"] != null ? num["208"] : (num["957"] != null ? num["957"] : num["958"]);
        if (k == null || isNaN(k)) return null;
        const ss = +x.servingSize, unit = String(x.servingSizeUnit || "").toLowerCase();
        const u = ss > 0 && (unit === "g" || unit === "grm") ? [["serving" + (x.householdServingFullText ? " (" + x.householdServingFullText.toLowerCase() + ")" : " (" + ss + " g)"), ss]] : [];
        return { n: titleCase(x.description) + (x.brandName || x.brandOwner ? " (" + titleCase(x.brandName || x.brandOwner) + ")" : ""), k, p: num["203"] || 0, f: num["204"] || 0, c: num["205"] || 0, u };
      }).filter(Boolean).slice(0, 10);
      fs.offMsg = fs.off.length ? "These come from the USDA food database. Brand-name numbers can differ from your label, so check it if you can." : "Nothing found. Try fewer words, or use Something else on a meal.";
    } catch (e) { fs.offMsg = e.message === "busy" ? "Food search is busy right now. Try again in a little while, or use Something else on a meal." : "Couldn't reach the food database. Check your connection and try again."; }
    fs.busy = false; refreshFood();
  }
  function refreshFood() { const el = document.getElementById("fres"); if (el) el.innerHTML = foodResults(); }
  /* ---------- MEALS: diary by meal + add-food sheet ---------- */
  const macroLine = (p, c, f) => `P ${r1(+p || 0)}g &middot; C ${r1(+c || 0)}g &middot; F ${r1(+f || 0)}g`;
  function mealSummary(d) {
    const done = consumed(d), T = C.targets, left = Math.round(T.calories - done.cal);
    const col = (lab, v, t) => `<div class="msum-c"><div class="l">${lab}</div><div class="v">${Math.round(v)}<span> / ${t}g</span></div><div class="bar"><i style="width:${pctOf(v, t)}%"></i></div></div>`;
    return `<div class="msum"><div class="msum-top"><div><div class="l">Calories</div><div class="big">${done.cal.toLocaleString()}<span class="muted"> / ${T.calories.toLocaleString()}</span></div></div>
      <div class="msum-left ${left < 0 ? "over" : ""}"><b>${Math.abs(left).toLocaleString()}</b><span>${left >= 0 ? "left today" : "over"}</span></div></div>
      <div class="bar ${done.cal >= T.calories * 0.9 && done.cal <= T.calories * 1.1 ? "good" : ""}"><i style="width:${pctOf(done.cal, T.calories)}%"></i></div>
      <div class="msum-cols">${col("Protein", done.p, T.protein)}${col("Carbs", done.c, T.carbs)}${col("Fat", done.f, T.fat)}</div></div>`;
  }
  function loggedRow(x, i, showSlot) {
    return `<div class="frow"><div class="frow-main"><div class="fn">${esc(x.n)}</div><div class="fm">${showSlot && x.slot ? esc(x.slot) + " &middot; " : ""}${esc(x.amt || "")}</div><div class="fm">${macroLine(x.p, x.c, x.f)}</div></div>
      <div class="frow-r"><div class="fc">${Math.round(x.cal)}<span> cal</span></div>${ctx.readOnly ? "" : `<div class="fa"><button class="linkbtn" data-act="ssave" data-i="${i}" aria-label="Save ${esc(x.n)} for later">Save</button><button class="linkbtn" data-act="fdel" data-i="${i}" aria-label="Remove ${esc(x.n)}">Remove</button></div>`}</div></div>`;
  }
  const addBtn = slot => ctx.readOnly ? "" : `<button class="addfood" data-act="fopen" data-slot="${esc(slot)}"><span>+</span> Add food</button>`;
  function slotSection(slot, items) {
    const tot = items.reduce((a, o) => ({ cal: a.cal + (+o.x.cal || 0), p: a.p + (+o.x.p || 0), c: a.c + (+o.x.c || 0), f: a.f + (+o.x.f || 0) }), { cal: 0, p: 0, c: 0, f: 0 });
    return `<section class="mseg"><div class="mhead"><h3>${slot === "Snack" ? "Snacks" : esc(slot)}</h3><div class="mtot">${items.length ? Math.round(tot.cal) + " cal" : ""}</div></div>
      ${items.length ? `<div class="mtotm">${macroLine(tot.p, tot.c, tot.f)}</div>` + items.map(o => loggedRow(o.x, o.i)).join("") : `<div class="mempty">Nothing logged yet</div>`}${addBtn(slot)}</section>`;
  }
  function swapPanel(m, i, d) {
    const cur = (d.mv || {})[i] || 0, c = (d.custom || {})[i] || {};
    const opt = (val, label, sub) => `<button class="opt ${String(cur) === String(val) ? "on" : ""}" data-act="mealopt" data-i="${i}" data-v="${val}"><strong>${esc(label)}</strong>${sub ? `<span class="muted small"> ${esc(sub)}</span>` : ""}</button>`;
    const fld = (k, label, val) => `<div><label class="field">${label}</label><input type="number" inputmode="numeric" data-f="cust" data-i="${i}" data-k="${k}" value="${val || ""}"></div>`;
    return `<div class="swapbox"><div class="muted small" style="margin-bottom:8px">What did you eat for ${esc(m.name.toLowerCase())}?</div>
      ${opt(0, "As planned", m.cal + " cal")}${(m.swaps || []).map((sw, k) => opt(k + 1, sw.name, sw.cal + " cal")).join("")}${opt("c", "Something else", "enter it below")}
      ${cur === "c" ? `<div style="margin-top:10px"><label class="field">What was it?</label><input type="text" data-f="cust" data-i="${i}" data-k="note" value="${esc(c.note || "")}">
        <div class="grid2" style="margin-top:8px">${fld("cal", "Calories", c.cal)}${fld("p", "Protein (g)", c.p)}${fld("c", "Carbs (g)", c.c)}${fld("f", "Fat (g)", c.f)}</div>
        <div class="muted small" style="margin-top:6px">A rough guess is fine. Leave blank if you don't know.</div></div>` : ""}</div>`;
  }
  function planSection(m, i, d) {
    const v = mealVariant(m, i, d), eaten = !!d.meals[i];
    return `<section class="mseg plan ${eaten ? "eaten" : ""}"><div class="mhead tap" data-act="meal" data-i="${i}" role="checkbox" aria-checked="${eaten}" tabindex="0"><div><h3>${esc(m.name)}</h3>${v.label ? `<span class="badge">${esc(v.label)}</span>` : ""}</div>
        <div class="eatchip ${eaten ? "on" : ""}"><span class="tick">${eaten ? "&#10003;" : ""}</span>${eaten ? "Eaten" : "Mark eaten"}</div></div>
      ${m.note ? `<div class="mnote">${esc(m.note)}</div>` : ""}
      <ul class="mitems">${v.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="mstats"><div><b>${v.cal}</b><span>cal</span></div><div><b>${v.p}g</b><span>protein</span></div><div><b>${v.c}g</b><span>carbs</span></div><div><b>${v.f}g</b><span>fat</span></div></div>
      ${ctx.readOnly ? "" : `<button class="linkbtn" data-act="swapopen" data-i="${i}">${swapOpen[i] ? "Close" : "Swap or change this meal"}</button>`}
      ${swapOpen[i] && !ctx.readOnly ? swapPanel(m, i, d) : ""}</section>`;
  }
  const FTABS = [["search", "Search"], ["recent", "Recent"], ["saved", "Saved"], ["manual", "By hand"]];
  function sheetBody() {
    if (fs.tab === "recent") {
      const y = yesterdayFoods(), r = recentFoods(12);
      return (y.length ? `<button class="opt" data-act="frepeat"><strong>Repeat yesterday's foods</strong><span class="muted small"> ${y.length} item${y.length > 1 ? "s" : ""}, ${Math.round(y.reduce((a, f) => a + (+f.cal || 0), 0))} cal</span></button>` : "")
        + (r.length ? `<label class="field" style="margin-top:14px">Foods you've logged lately</label>` + r.map((f, i) => `<button class="opt" data-act="frecent" data-i="${i}"><strong>${esc(f.n)}</strong><span class="muted small"> ${Math.round(f.cal)} cal &middot; ${esc(f.amt || "")}</span></button>`).join("") : `<div class="muted">Foods you log will show up here for one-tap adding.</div>`);
    }
    if (fs.tab === "saved") return (saved && saved.length ? savedPanel().replace(/^<div style="[^"]*">/, "<div>").replace('<label class="field">Your saved meals</label>', "") : `<div class="muted">Tap Save on any food you've logged and it will be here for next time.</div>${savedNote ? `<div class="muted small" style="margin-top:8px">${esc(savedNote)}</div>` : ""}`);
    if (fs.tab === "manual") return manualPanel();
    return `<div class="srch"><input id="fq" type="text" data-f="fq" enterkeyhint="search" autocomplete="off" autocapitalize="none" placeholder="Search chicken, rice, Greek yogurt..." value="${esc(fs.q)}"><button class="btn ghost sm" data-act="fscan">Scan</button></div>
      <div id="fres">${foodResults()}</div>${foodPanel()}`;
  }
  function addSheet() {
    if (!fs.open || ctx.readOnly) return "";
    return `<div class="sheet-ov"><div class="sheet-p" role="dialog" aria-label="Add food"><div class="sheet-h"><div><div class="eyebrow" style="margin:0 0 4px">Add to</div><h3>${esc(curSlot() === "Snack" ? "Snacks" : curSlot())}</h3></div><button class="btn ghost sm" data-act="fclose">Done</button></div>
      <div class="seg2">${FTABS.map(t => `<button data-act="ftab" data-v="${t[0]}" class="${fs.tab === t[0] ? "on" : ""}">${t[1]}</button>`).join("")}</div>${sheetBody()}</div></div>`;
  }
  const pctOf = (v, t) => (t ? Math.max(0, Math.min(100, Math.round(v / t * 100))) : 0);

  function leftLine(done) {
    const T = C.targets;
    const f = (lab, t, v, u) => { const x = Math.round(t - v); return x >= 0 ? x.toLocaleString() + u + " " + lab : Math.abs(x).toLocaleString() + u + " over on " + lab; };
    return `Left today: ${f("calories", T.calories, done.cal, "")} &middot; ${f("protein", T.protein, done.p, "g")} &middot; ${f("carbs", T.carbs, done.c, "g")} &middot; ${f("fat", T.fat, done.f, "g")}`;
  }

  function ring(pct, text, sub) {
    const c = 2 * Math.PI * 34;
    return `<svg class="ring" viewBox="0 0 80 80" role="img" aria-label="${esc(sub)} ${esc(text)}">
      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--line)" stroke-width="8"/>
      <circle cx="40" cy="40" r="34" fill="none" stroke="${pct >= 100 ? "var(--good)" : "var(--amber)"}" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>
      <text x="40" y="46" text-anchor="middle" class="ringtext">${esc(text)}</text></svg>`;
  }

  const flame = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 2c1.2 4.2-3.6 5.4-3.6 9.6a5.6 5.6 0 0011.2 0c0-2.2-1-3.6-2.2-4.8 0 2.2-1 3.4-2.2 3.4 1.2-4.4-.6-6.6-3.2-8.2z" fill="var(--amber)"/></svg>`;

  const rate = (d, key, label) => { const ci = d.checkin || {}; return `<div class="field">${label}</div><div class="rate">${[1, 2, 3, 4, 5].map(n => `<button data-act="rate" data-k="${key}" data-v="${n}" class="${ci[key] === n ? "on" : ""}">${n}</button>`).join("")}</div>`; };

  /* ---------- HOME ---------- */
  function weekCard() {
    const end = toDate(date), ks = [];
    for (let i = 6; i >= 0; i--) { const x = new Date(end); x.setDate(x.getDate() - i); ks.push(iso(x)); }
    const recs = ks.map(k => S.days[k] || {});
    if (recs.filter(r => r.weight || r.steps || r.sleepHrs || (r.foods || []).length || (r.water || 0) > 0 || r.checkin).length < 3) return "";
    const avgOf = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const sched = ks.filter(k => k >= C.startDate && workoutFor(k) !== "Rest");
    const trained = ks.filter(k => k >= C.startDate && dayLifted(k)).length;
    const steps = recs.map(r => r.steps).filter(Boolean), sl = recs.map(r => r.sleepHrs).filter(Boolean);
    const cis = recs.filter(r => checkinDone(r)).length;
    const cell = (l, v, s) => `<div class="wk"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    return `<h2>Last 7 days</h2><div class="card wkcard">
      ${cell("Workouts", sched.length || trained ? trained + "/" + Math.max(sched.length, trained) : "-", "sessions done")}
      ${cell("Steps", steps.length ? Math.round(avgOf(steps)).toLocaleString() : "-", "daily average")}
      ${cell("Sleep", sl.length ? (Math.round(avgOf(sl) * 10) / 10) + " h" : "-", "nightly average")}
      ${cell("Check-ins", cis + "/7", "days done")}</div>`;
  }
  function installCard() {
    if (ctx.readOnly) return "";
    let dismissed = false; try { dismissed = localStorage.getItem("installHint") === "1"; } catch (e) {}
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    if (dismissed || standalone) return "";
    if (window.__bip) return `<div class="card note"><div class="eyebrow">Install the app</div>Add Awwab Fitness to your home screen so it opens like a normal app.<div class="btns"><button class="btn" data-act="installgo">Install</button><button class="btn ghost" data-act="installx">Not now</button></div></div>`;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return `<div class="card note"><div class="eyebrow">Add to your home screen</div>Tap the Share button in Safari, then <strong>Add to Home Screen</strong>. It opens full screen like a normal app and keeps you logged in.<div class="btns"><button class="btn ghost" data-act="installx">Got it</button></div></div>`;
    return "";
  }
  function viewHome() {
    const d = dayRec(date);
    const done = consumed(d);
    const t = tasks(date);
    const nDone = t.filter(x => x.done).length;
    const T = C.targets;
    const hr = new Date().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const first = C.name || "";
    let h = header(date === realToday ? `${greet}, ${first}` : toDate(date).toLocaleDateString(undefined, { weekday: "long" }), niceDate(date));
    h += installCard();

    h += `<div class="duo" style="margin-top:16px">
      ${F.streaks ? `<button class="card streakcard" data-go="streaks" aria-label="See your streaks"><div class="flame">${flame}</div><div class="big">${streak()}</div><div class="muted small">day streak</div><div class="muted small">Best ${bestStreak()}</div></button>` : ""}
      <div class="card ringcard">${ring(Math.round(nDone / t.length * 100), nDone + "/" + t.length, "Today")}<div class="muted small">done today</div></div>
    </div>`;

    if (F.goalBar) {
      const lost = C.startWeight - latestWeight();
      const gp = pctOf(lost, C.startWeight - C.goalWeight);
      h += `<button class="card" data-go="progress" style="width:100%;text-align:left;font:inherit;color:inherit">
        <div class="rowline"><span class="eyebrow" style="margin:0">Week ${weekNum()} of ${C.totalWeeks}</span><span class="muted small">${latestWeight()} lbs now${(() => { const p = weights(); const recent = p.filter(q => toDate(q.date) > new Date(Date.now() - 7 * 864e5)); return recent.length >= 3 ? " (7-day avg " + (recent.reduce((a, q) => a + q.w, 0) / recent.length).toFixed(1) + ")" : ""; })()}</span></div>
        <div class="bar"><i style="width:${Math.round(weekNum() / C.totalWeeks * 100)}%"></i></div>
        <div class="rowline" style="margin-top:12px"><span class="muted small">${C.startWeight} lbs start</span><span class="muted small">${lost > 0 ? lost.toFixed(1).replace(/\.0$/, "") + " lbs down" : ""}</span><span class="muted small">${C.goalWeight} lbs goal</span></div>
        <div class="bar good"><i style="width:${gp}%"></i></div>
        <div class="muted small" style="margin-top:10px">See your progress &rsaquo;</div></button>`;
    }

    const wk = workoutFor(date);
    const exs = C.workouts[wk] || [];
    const exDone = exs.filter(x => loggedSets(date, x).length).length;
    const w = d.water || 0;
    const tile = (go, label, value, sub, pct) => `<button class="tile2" data-go="${go}"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div><div class="bar ${pct >= 100 ? "good" : ""}"><i style="width:${pct}%"></i></div></button>`;
    h += `<h2>Today at a glance</h2><div class="tiles2">
      ${tile("training", "Training", wk === "Rest" ? "Rest" : esc(wk), wk === "Rest" ? "Recover today" : exDone + " of " + exs.length + " exercises", wk === "Rest" ? 100 : pctOf(exDone, exs.length))}
      ${tile("nutrition", "Calories", done.cal.toLocaleString(), "of " + T.calories.toLocaleString(), pctOf(done.cal, T.calories))}
      ${tile("nutrition", "Protein", Math.round(done.p) + "g", "of " + T.protein + "g", pctOf(done.p, T.protein))}
      ${tile("nutrition", "Water", w + " oz", "of " + T.water + " oz", pctOf(w, T.water))}
    </div>`;

    h += weekCard();
    if (C.coachNote) h += `<div class="card note" style="margin-top:16px"><div class="eyebrow">Note from your coach</div>${esc(C.coachNote)}</div>`;

    h += `<h2>Log your day</h2><div class="card"><div class="grid2">
      <div><label class="field" for="weight">Weigh-in (lbs)</label><input id="weight" type="number" inputmode="decimal" step="0.1" data-f="weight" value="${d.weight || ""}" placeholder="morning"></div>
      <div><label class="field" for="steps">Steps</label><input id="steps" type="number" inputmode="numeric" data-f="steps" value="${d.steps || ""}" placeholder="${T.steps.toLocaleString()}"></div></div>
      ${F.sleepLog === false ? "" : `<div class="grid2" style="margin-top:10px"><div><label class="field" for="sleep">How many hours did you sleep last night?</label><input id="sleep" type="number" inputmode="decimal" step="0.25" min="0" max="24" data-f="sleep" value="${d.sleepHrs || ""}" placeholder="e.g. 7.5"></div></div>`}</div>`;

    const ciDone = checkinDone(d);
    h += `<div class="card"><div class="rowline"><h3>Daily check-in</h3><span class="chip ${ciDone ? "done" : ""}">${ciDone ? "Done" : "Not yet"}</span></div>`;
    if (!checkinOpen) {
      h += `<div class="muted small" style="margin:6px 0 0">Rate your nutrition, intensity and sleep. Takes 10 seconds.</div><div class="btns"><button class="btn" data-act="ciopen">${ciDone ? "Edit check-in" : "Do your check-in"}</button></div>`;
    } else {
      h += `<div class="muted small" style="margin:6px 0 10px">1 is rough, 5 is great.</div>${rate(d, "n", "Nutrition")}${rate(d, "i", "Intensity")}${rate(d, "s", "Sleep")}
        ${F.hungerEnergy ? rate(d, "h", "Hunger (optional)") + rate(d, "e", "Energy (optional)") : ""}`;
      if (F.offPlan) {
        const off = d.offPlan || {};
        h += `<div class="toggle" data-act="offplan"><div class="check" style="background:${off.on ? "var(--amber)" : "transparent"};border-color:${off.on ? "var(--amber)" : "var(--line)"}">${off.on ? "&#10003;" : ""}</div>I ate off plan today</div>
          ${off.on ? `<textarea data-f="offnote" placeholder="What did you eat? Why?" style="margin-top:10px">${esc(off.note || "")}</textarea>` : ""}`;
      }
      h += `<div class="btns"><button class="btn ghost" data-act="ciclose">Close</button></div>`;
    }
    h += `</div>`;

    if (F.photoReminder) {
      const n = ((S.days[realToday] || {}).photos || []).length;
      h += `<button class="card" data-go="progress" style="width:100%;text-align:left;font:inherit;color:inherit"><div class="eyebrow" style="margin-bottom:4px">Progress photos</div>
        <div>${n ? n + " added today" : "Take your front, side and back photos."}</div><div class="muted small" style="margin-top:6px">Add photos &rsaquo;</div></button>`;
    }
    return h;
  }

  /* ---------- form videos ("How to") ---------- */
  let howEx = null;
  const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function formInfo(ex) {
    const n = normName(ex), pick = src => { if (!src) return null; const k = Object.keys(src).find(x => normName(x) === n); if (!k) return null; const v = src[k]; return typeof v === "string" ? { url: v, cues: [] } : v; };
    const f = pick(C.videos) || pick(window.FORM_VIDEOS);
    return f && (f.url || (f.cues && f.cues.length)) ? f : null;
  }
  function embedFor(url) {
    const u = String(url || "");
    const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
    if (yt) return { src: "https://www.youtube-nocookie.com/embed/" + yt[1] + "?rel=0&playsinline=1", vertical: /\/shorts\//.test(u) };
    const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return { src: "https://player.vimeo.com/video/" + vm[1] };
    if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(u)) return { file: u };
    return null;
  }
  function howSheet() {
    if (!howEx) return "";
    const f = formInfo(howEx); if (!f) return "";
    const em = f.url ? embedFor(f.url) : null;
    const player = em ? (em.src ? `<div class="vid ${em.vertical ? "vert" : ""}"><iframe src="${esc(em.src)}" title="${esc(howEx)} form video" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>` : `<video class="vidfile" src="${esc(em.file)}" controls playsinline preload="metadata"></video>`)
      : (f.url ? `<a class="btn" style="display:inline-block;text-decoration:none" href="${esc(f.url)}" target="_blank" rel="noopener">Watch the video</a>` : "");
    return `<div class="sheet-ov"><div class="sheet-p" role="dialog" aria-label="How to do ${esc(howEx)}"><div class="sheet-h"><div><div class="eyebrow" style="margin:0 0 4px">How to do it</div><h3>${esc(howEx)}</h3></div><button class="btn ghost sm" data-act="hclose">Done</button></div>
      ${player}${(f.cues || []).length ? `<h2 style="margin-top:22px">Key cues</h2><ul class="cues">${f.cues.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}</div></div>`;
  }
  const howBtn = ex => formInfo(ex) ? `<button class="howbtn" data-act="how" data-ex="${esc(ex)}" aria-label="How to do ${esc(ex)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>How to</button>` : "";

  /* ---------- TRAINING ---------- */
  const topW = (k, ex) => Math.max(0, ...loggedSets(k, ex).map(s => parseFloat(s.w) || 0));
  const prevSessions = ex => Object.keys(S.lifts).filter(k => k < date && loggedSets(k, ex).length).sort();
  function hintFor(ex) {
    const ds = prevSessions(ex);
    if (!ds.length) return "";
    const sets = loggedSets(ds[ds.length - 1], ex);
    const w = Math.max(0, ...sets.map(s => parseFloat(s.w) || 0));
    const reps = sets.filter(s => (parseFloat(s.w) || 0) === w).map(s => parseInt(s.r, 10) || 0);
    const hitAll = reps.length >= Math.min(C.sets, sets.length) && reps.every(r => r >= C.reps);
    if (!w) return "Aim for " + ((Math.min(...reps) || 0) + 1) + " reps.";
    if (hitAll) return "You hit " + C.reps + " reps on every set at " + w + " lbs. Try " + (w + 5) + " lbs.";
    return "Stay at " + w + " lbs and aim for " + Math.min(C.reps, Math.min(...reps) + 1) + "+ reps on every set.";
  }
  function prBadge(ex) {
    const t = topW(date, ex);
    if (!t) return "";
    const prev = Math.max(0, ...prevSessions(ex).map(k => topW(k, ex)));
    return prev && t > prev ? `<span class="badge">New best: ${t} lbs</span>` : "";
  }

  function lastSession(ex) {
    const dates = Object.keys(S.lifts).filter(k => k < date && loggedSets(k, ex).length).sort();
    if (!dates.length) return "";
    const k = dates[dates.length - 1];
    return "Last time: " + loggedSets(k, ex).map(s => `${s.w || "?"} &times; ${s.r}`).join(", ");
  }

  let showAllLifts = false;
  // only = name of today's session: show just those exercises (with a link to see every lift). No arg = all lifts.
  function liftHistory(only) {
    const filtered = only && C.workouts[only] && !showAllLifts;
    let h = `<h2>Lift progress${filtered ? " - " + esc(only) : ""}</h2>`;
    let any = false;
    Object.keys(C.workouts).filter(name => !filtered || name === only).forEach(name => {
      C.workouts[name].forEach(ex => {
        const dates = Object.keys(S.lifts).filter(k => loggedSets(k, ex).length).sort().slice(-3).reverse();
        if (!dates.length) return;
        any = true;
        const tops = Object.keys(S.lifts).filter(k => loggedSets(k, ex).length).sort()
          .map(k => ({ date: k, w: Math.max(...loggedSets(k, ex).map(s => parseFloat(s.w) || 0)) })).filter(p => p.w > 0);
        h += `<div class="card"><div class="rowline"><h3 style="color:var(--ink)">${esc(ex)}</h3>${tops.length ? `<span class="muted small">Best ${Math.max(...tops.map(p => p.w))} lbs</span>` : ""}</div>`
          + (tops.length > 1 ? chart(tops) : "") + dates.map(k =>
          `<div class="rowline small" style="margin-top:6px"><span class="muted">${toDate(k).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>${loggedSets(k, ex).map(s => `${s.w || "?"} &times; ${s.r}`).join(", ")}</span></div>`).join("") + `</div>`;
      });
    });
    h += any ? "" : `<div class="card muted">Your logged lifts will show up here.</div>`;
    if (only && C.workouts[only] && Object.keys(C.workouts).length > 1) h += `<div style="text-align:center;margin:6px 0 10px"><a href="#" class="muted small" data-act="liftall">${showAllLifts ? "Show only " + esc(only) + " lifts" : "Show all lifts"}</a></div>`;
    return h;
  }

  function viewTraining() {
    const wk = workoutFor(date);
    let h = header(wk === "Rest" ? "Rest day" : wk, "Training - " + niceDate(date));
    h += `<div class="muted small" style="margin:14px 0 6px">What did you train? Change it if you did a different session than scheduled.${C.rotation ? " Your suggested session follows your rotation, so a skipped day just pushes the order back." : ""}</div>
      <div class="seg">${Object.keys(C.workouts).concat("Rest").map(t => `<button data-act="wtype" data-v="${esc(t)}" class="${t === wk ? "on" : ""}">${esc(t)}</button>`).join("")}</div>`;
    if (wk === "Rest") {
      h += `<div class="card">No lifting today. Hit your steps, water and meals, and get good sleep.</div>`;
    } else {
      const exs = C.workouts[wk];
      const nDone = exs.filter(x => loggedSets(date, x).length).length;
      h += `<div class="card"><div class="rowline"><span class="big">${nDone} of ${exs.length} exercises</span></div>
        <div class="bar ${nDone === exs.length ? "good" : ""}"><i style="width:${Math.round(nDone / exs.length * 100)}%"></i></div>
        <div class="muted small" style="margin-top:8px">${C.sets} sets of ${C.reps}. Log the weight and the reps you hit.</div></div>`;
      h += exs.map((ex, xi) => {
        const rec = (S.lifts[date] || {})[ex] || [];
        let rows = "";
        const pds = prevSessions(ex), pset = pds.length ? loggedSets(pds[pds.length - 1], ex) : [];
        for (let s = 0; s < C.sets; s++) {
          const v = rec[s] || {}, pv = pset[s] || pset[pset.length - 1] || {};
          rows += `<div class="sn">${s + 1}</div>
            <input type="number" inputmode="decimal" placeholder="${esc(pv.w || "lbs")}" data-lift="${xi}" data-set="${s}" data-fld="w" value="${v.w || ""}" aria-label="${esc(ex)} set ${s + 1} weight">
            <input type="number" inputmode="numeric" placeholder="${esc(pv.r || "reps")}" data-lift="${xi}" data-set="${s}" data-fld="r" value="${v.r || ""}" aria-label="${esc(ex)} set ${s + 1} reps">`;
        }
        const last = lastSession(ex), hint = hintFor(ex);
        return `<div class="card ex"><div class="rowline"><h3 style="color:var(--ink)">${esc(ex)}</h3><span class="exr">${prBadge(ex)}${howBtn(ex)}</span></div><div class="sets">${rows}</div>${last ? `<div class="last">${last}</div>` : ""}${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
      }).join("");
    }
    h += liftHistory(wk);
    h += `<h2>Weekly schedule</h2><div class="card">` + [1, 2, 3, 4, 5, 6, 0].map(i =>
      `<div class="rowline" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}</span><strong>${esc(C.schedule[i])}</strong></div>`).join("") + `</div>`;
    return h + howSheet();
  }

  /* ---------- NUTRITION ---------- */
  function viewNutrition() {
    const d = dayRec(date), done = consumed(d), T = C.targets, w = d.water || 0;
    let h = header("Nutrition", niceDate(date));
    const mac = (label, v, t, unit) => `<div class="macro"><div class="n">${Math.round(v)}${unit}</div><div class="l">${label}</div><div class="t">of ${t}${unit}</div><div class="bar" style="margin-top:6px"><i style="width:${pctOf(v, t)}%"></i></div></div>`;
    h += `<div class="card" style="margin-top:16px"><div class="rowline"><span class="big">${done.cal.toLocaleString()}</span><span class="muted">of ${T.calories.toLocaleString()} calories</span></div>
      <div class="bar ${done.cal >= T.calories ? "good" : ""}"><i style="width:${pctOf(done.cal, T.calories)}%"></i></div>
      <div class="muted small" style="margin-top:8px">${leftLine(done)}</div>
      <div class="muted small" style="margin-top:4px">${C.meals.length ? "Check off your meals on the Meals tab and these numbers fill in." : "Log what you eat on the Food tab and these numbers fill in."}</div></div>
      <div class="macros">${mac("Protein", done.p, T.protein, "g")}${mac("Carbs", done.c, T.carbs, "g")}${mac("Fat", done.f, T.fat, "g")}</div>`;
    h += `<h2>Water</h2><div class="card"><div class="rowline"><span class="big">${w}<span class="muted small"> / ${T.water} oz</span></span></div>
      <div class="bar ${w >= T.water ? "good" : ""}"><i style="width:${pctOf(w, T.water)}%"></i></div>
      <div class="btns"><button class="btn" data-act="water" data-v="8">+ 8 oz</button><button class="btn" data-act="water" data-v="16">+ 16 oz</button><button class="btn" data-act="water" data-v="32">+ 32 oz</button><button class="btn ghost" data-act="water" data-v="-8">- 8 oz</button></div></div>`;
    h += `<h2>How your numbers work</h2>` + (C.plan || []).filter(s => /nutrition|daily/i.test(s.h)).map(s => `<div class="card"><h3>${esc(s.h)}</h3><div>${esc(s.p)}</div></div>`).join("");
    h += `<div class="muted small">Fat target is about ${T.fat}g. The ceiling is ${T.fatCeiling}g, and it's fine to land under it.</div>`;
    return h;
  }

  /* ---------- MEALS ---------- */
  function viewMeals() {
    const d = dayRec(date), planMode = C.meals.length > 0, list = d.foods || [];
    let h = header(planMode ? "Meals" : "Food", niceDate(date));
    h += mealSummary(d);
    if (planMode) {
      const n = d.meals.filter(Boolean).length;
      h += `<h2>Your plan <span class="h2n">${n} of ${C.meals.length} eaten</span></h2>` + C.meals.map((m, i) => planSection(m, i, d)).join("");
      h += `<h2>Extras</h2><div class="muted small" style="margin:-4px 0 10px">Ate something that isn't in your plan? Add it here so your numbers stay honest.</div>`;
      h += `<section class="mseg">${list.length ? list.map((x, i) => loggedRow(x, i, true)).join("") : `<div class="mempty">No extra foods today</div>`}${addBtn(curSlot())}</section>`;
      if (C.mealNote) h += `<div class="muted small" style="margin-top:14px">${esc(C.mealNote)}</div>`;
    } else {
      h += `<h2>Today</h2>` + SLOTS.map(sl => slotSection(sl, list.map((x, i) => ({ x, i })).filter(o => (SLOTS.includes(o.x.slot) ? o.x.slot : "Snack") === sl))).join("");
      h += `<div class="muted small" style="margin-top:6px">Weigh food raw when you can. Search it, enter the weight, and it adds up here.</div>`;
    }
    return h + addSheet();
  }

  /* ---------- NOTES ---------- */
  function viewNotes() {
    const d = dayRec(date);
    let h = header("Notes", ctx.isSelf ? "Your plan" : "From your coach");
    if (!ctx.isSelf) h += C.coachNote ? `<div class="card note" style="margin-top:16px"><div class="eyebrow">Note from your coach</div>${esc(C.coachNote)}</div>` : `<div class="card muted" style="margin-top:16px">No note from your coach today.</div>`;
    if (F.weeklyReview && C.weeklyReview) {
      const r = C.weeklyReview;
      h += `<h2>${esc(r.title)}</h2><div class="card"><h3>Wins</h3><div>${esc(r.wins)}</div><h3 style="margin-top:12px">Focus this week</h3><div>${esc(r.focus)}</div></div>`;
    }
    const fmt = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (!ctx.isSelf) h += `<h2>Messages</h2><div class="card"><div class="thread">${msgs.length ? msgs.map(m => `<div class="bub ${m.sender}">${esc(m.body)}<div class="bt">${m.sender === "coach" ? "Coach" : "You"} &middot; ${esc(fmt(m.created_at))}</div></div>`).join("") : `<div class="muted small">No messages yet.${ctx.readOnly ? "" : " Ask your coach anything."}</div>`}</div>
      ${ctx.readOnly ? "" : `<label class="field" for="msgbox" style="margin-top:12px">Message your coach</label><textarea id="msgbox" placeholder="Type here. Hunger, sore, travel, questions. Your coach sees it."></textarea>
        ${msgNote ? `<div class="muted small" style="margin-top:6px">${esc(msgNote)}</div>` : ""}<div class="btns"><button class="btn" data-act="sendmsg">Send</button></div>`}</div>`;
    h += `<h2>Plan notes</h2>` + (C.plan || []).map(s => `<div class="card"><h3>${esc(s.h)}</h3><div>${esc(s.p)}</div></div>`).join("");
    if (ctx.readOnly) return h + `<div class="btns" style="margin-top:20px"><button class="btn ghost" data-act="logout">Back to coach view</button></div>`;
    h += `<h2>Account</h2><div class="card"><h3>Change password</h3>
      <label class="field" for="pw1">New password (8 or more characters)</label><input id="pw1" type="password" autocomplete="new-password">
      <label class="field" for="pw2" style="margin-top:10px">Type it again</label><input id="pw2" type="password" autocomplete="new-password">
      ${pwMsg ? `<div class="${pwOk ? "muted" : "err"} small" style="margin-top:8px">${esc(pwMsg)}</div>` : ""}
      <div class="btns"><button class="btn" data-act="setpw">Update password</button></div></div>
      <div class="card"><h3>Your data</h3><div class="muted small">Download everything you've logged as a spreadsheet file.</div><div class="btns"><button class="btn ghost" data-act="mydata">Download my data (CSV)</button></div></div>
      <div class="card"><div class="rowline"><div><h3>Rest timer</h3><div class="muted small">Starts after you log a set so you know when to lift again.</div></div><button class="btn ${restOn() ? "" : "ghost"}" data-act="resttoggle">${restOn() ? "On" : "Off"}</button></div></div>`;
    h += `<div class="btns" style="margin-top:20px">${ctx.isSelf ? `<button class="btn" data-act="tocoach">Switch to coach view</button>` : ""}<button class="btn ghost" data-act="logout">Log out</button></div>`;
    h += `<div class="brandfoot"><img src="icon-192.png?v=38" alt="" width="56" height="56"><div><strong>Awwab Fitness</strong><div class="muted small">12-week coaching &middot; Est. 2026</div></div></div>`;
    h += `<div class="muted small" style="margin-top:18px;text-align:center"><a href="https://awwabidris21.github.io/Coaching-Policies-/terms.html" target="_blank" rel="noopener">Terms</a> &middot; <a href="https://awwabidris21.github.io/Coaching-Policies-/privacy.html" target="_blank" rel="noopener">Privacy</a></div>`;
    return h;
  }

  /* ---------- PROGRESS (from Home) ---------- */
  function avg7(pts) {
    return pts.map(p => {
      const t = toDate(p.date).getTime();
      const win = pts.filter(q => { const u = toDate(q.date).getTime(); return u <= t && u > t - 7 * 864e5; });
      return { date: p.date, w: +(win.reduce((a, q) => a + q.w, 0) / win.length).toFixed(1) };
    });
  }
  function chart(points, avg) {
    if (points.length < 2) return `<div class="muted">Log your weight a few days to see the chart.</div>`;
    const W = 340, H = 150, pad = 28;
    const ws = points.concat(avg || []).map(p => p.w);
    const lo = Math.floor(Math.min(...ws) - 1), hi = Math.ceil(Math.max(...ws) + 1);
    const t0 = toDate(points[0].date).getTime(), t1 = toDate(points[points.length - 1].date).getTime();
    const x = p => pad + (t1 === t0 ? 0 : (toDate(p.date).getTime() - t0) / (t1 - t0)) * (W - pad - 10);
    const y = p => 10 + (1 - (p.w - lo) / (hi - lo)) * (H - 30);
    const path = points.map((p, i) => (i ? "L" : "M") + x(p).toFixed(1) + " " + y(p).toFixed(1)).join(" ");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart over time">
      <line x1="${pad}" y1="${H - 20}" x2="${W - 10}" y2="${H - 20}" stroke="var(--line)"/>
      <text x="2" y="${y({ w: hi }) + 4}">${hi}</text><text x="2" y="${y({ w: lo }) + 4}">${lo}</text>
      ${avg ? `<path d="${avg.map((p, i) => (i ? "L" : "M") + x(p).toFixed(1) + " " + y(p).toFixed(1)).join(" ")}" fill="none" stroke="var(--good)" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round"/>` : ""}
      <path d="${path}" fill="none" stroke="var(--amber)" stroke-width="${avg ? 1.5 : 2.5}" stroke-linejoin="round" stroke-linecap="round" ${avg ? 'opacity="0.55"' : ""}/>
      ${points.map(p => `<circle cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="${avg ? 3 : 3.5}" fill="var(--amber)"/>`).join("")}
      <text x="${pad}" y="${H - 6}">${toDate(points[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>
      <text x="${W - 50}" y="${H - 6}">${toDate(points[points.length - 1].date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text></svg>`;
  }

  function viewProgress() {
    const pts = weights();
    const first = pts.length ? pts[0].w : C.startWeight;
    const cur = latestWeight();
    let h = header("Progress", "Your results", true);
    h += `<div class="macros" style="grid-template-columns:repeat(3,1fr);margin-top:16px">
      <div class="macro"><div class="n">${first}</div><div class="l">Start</div></div>
      <div class="macro"><div class="n">${cur}</div><div class="l">Now</div></div>
      <div class="macro"><div class="n">${(first - cur).toFixed(1).replace(/\.0$/, "")}</div><div class="l">Lbs down</div></div></div>`;
    const av = avg7(pts);
    h += `<h2>Weight</h2><div class="card">${chart(pts, pts.length > 2 ? av : null)}${pts.length > 2 ? `<div class="legend"><span><i class="cell part"></i> Daily weigh-in</span><span><i class="cell full"></i> 7-day average${av.length ? " (" + av[av.length - 1].w + " lbs)" : ""}</span></div><div class="muted small" style="margin-top:8px">Your weight bounces day to day with water and food. The average is the number to watch.</div>` : ""}</div>`;
    const sp = Object.keys(S.days).sort().filter(k => S.days[k].sleepHrs).map(k => ({ date: k, w: S.days[k].sleepHrs }));
    if (F.sleepLog !== false && sp.length >= 2) {
      const last7 = sp.filter(x => toDate(x.date) > new Date(Date.now() - 7 * 864e5)).map(x => x.w);
      h += `<h2>Sleep</h2><div class="card">${chart(sp, null)}<div class="muted small" style="margin-top:8px">${last7.length ? "Average over the last 7 days: <strong>" + (Math.round(last7.reduce((a, b) => a + b, 0) / last7.length * 10) / 10) + " hours</strong>. " : ""}Most people feel best on 7 to 9 hours.</div></div>`;
    }
    return h + photosSection() + liftHistory();
  }

  /* ---------- STREAKS (from Home) ---------- */
  function dayScore(k) { const t = tasks(k); return t.filter(x => x.done).length / t.length; }
  function bestStreak() {
    let best = 0, cur = 0;
    const d = toDate(C.startDate), end = toDate(realToday);
    for (; d <= end; d.setDate(d.getDate() + 1)) {
      if (checkinDone(S.days[iso(d)])) { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    return best;
  }
  function viewStreaks() {
    let h = header("Streaks", "Your consistency", true);
    let perfect = 0;
    const d0 = toDate(C.startDate), end = toDate(realToday);
    for (const d = new Date(d0); d <= end; d.setDate(d.getDate() + 1)) if (dayScore(iso(d)) === 1) perfect++;
    h += `<div class="macros" style="grid-template-columns:repeat(3,1fr);margin-top:16px">
      <div class="macro"><div class="n">${streak()}</div><div class="l">Current streak</div></div>
      <div class="macro"><div class="n">${bestStreak()}</div><div class="l">Best streak</div></div>
      <div class="macro"><div class="n">${perfect}</div><div class="l">Perfect days</div></div></div>
      <div class="muted small" style="margin-top:8px">A streak counts every day you finish your daily check-in. A perfect day is everything on Home checked off.</div>`;

    const liftedDays = Object.keys(S.lifts).filter(k => dayLifted(k)).length;
    const dayKeys = Object.keys(S.days);
    const proteinDays = dayKeys.filter(k => consumed(S.days[k]).p >= C.targets.protein * 0.95).length;
    const sleepDays = dayKeys.filter(k => (S.days[k].sleepHrs || 0) >= 7).length;
    const weighIns = dayKeys.filter(k => S.days[k].weight).length;
    const best = bestStreak();
    const bd = (on, t, d) => `<div class="bdg ${on ? "on" : ""}"><div class="bi">${on ? "&#10003;" : "&middot;"}</div><div><strong>${t}</strong><div class="muted small">${d}</div></div></div>`;
    h += `<h2>Milestones</h2><div class="card badges">
      ${bd(liftedDays >= 1, "First workout", "Log your first session")}${bd(liftedDays >= 10, "10 workouts", liftedDays + " so far")}${bd(liftedDays >= 25, "25 workouts", liftedDays + " so far")}${bd(liftedDays >= 50, "50 workouts", liftedDays + " so far")}
      ${bd(best >= 7, "7-day streak", "Best: " + best)}${bd(best >= 14, "14-day streak", "Best: " + best)}${bd(best >= 30, "30-day streak", "Best: " + best)}${bd(perfect >= 1, "Perfect day", "Everything checked off")}
      ${bd(weighIns >= 7, "7 weigh-ins", weighIns + " so far")}${bd(proteinDays >= 7, "Protein x7", "Hit your protein " + proteinDays + (proteinDays === 1 ? " time" : " times"))}${bd(sleepDays >= 5, "Slept 7+ hours x5", sleepDays + (sleepDays === 1 ? " night" : " nights"))}</div>`;

    const start = toDate(realToday); start.setDate(start.getDate() - 27);
    let cells = ["S", "M", "T", "W", "T", "F", "S"].map(x => `<div class="dow">${x}</div>`).join("");
    for (let i = 0; i < start.getDay(); i++) cells += `<div class="cell empty"></div>`;
    for (let i = 0; i < 28; i++) {
      const k = iso(start);
      const sc = k < C.startDate ? null : dayScore(k);
      const cls = sc === null ? "off" : sc === 1 ? "full" : sc > 0 ? "part" : "none";
      cells += `<div class="cell ${cls}" ${cls === "part" ? `style="opacity:${(0.4 + 0.6 * sc).toFixed(2)}"` : ""} title="${k}: ${sc === null ? "-" : Math.round(sc * 100) + "%"}">${start.getDate()}</div>`;
      start.setDate(start.getDate() + 1);
    }
    h += `<h2>Last 4 weeks</h2><div class="card"><div class="grid7">${cells}</div>
      <div class="legend"><span><i class="cell full"></i> All done</span><span><i class="cell part"></i> Some</span><span><i class="cell none"></i> None</span></div></div>`;

    h += `<h2>Weekly completion</h2><div class="card">`;
    let rows = "";
    for (let b = 0; b < 6; b++) {
      const e = toDate(realToday); e.setDate(e.getDate() - 7 * b);
      const s0 = new Date(e); s0.setDate(s0.getDate() - 6);
      let sum = 0, n = 0;
      for (const d = new Date(s0); d <= e; d.setDate(d.getDate() + 1)) { const k = iso(d); if (k >= C.startDate) { sum += dayScore(k); n++; } }
      if (!n) continue;
      const pct = Math.round(sum / n * 100);
      const lab = s0.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " - " + e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      rows += `<div style="margin-bottom:12px"><div class="rowline small"><span>${b === 0 ? "This week (last 7 days)" : lab}</span><strong>${pct}%</strong></div><div class="bar ${pct >= 80 ? "good" : ""}"><i style="width:${pct}%"></i></div></div>`;
    }
    return h + (rows || `<div class="muted">Your weekly scores will show up here.</div>`) + `</div>`;
  }

  function myData() {
    const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ["date", "weight_lbs", "steps", "water_oz", "sleep_hours", "nutrition_1to5", "intensity_1to5", "sleep_1to5", "calories", "protein_g", "carbs_g", "fat_g", "session", "lifts"];
    const keys = [...new Set(Object.keys(S.days).concat(Object.keys(S.lifts)))].sort();
    const rows = keys.map(k => {
      const d = S.days[k] || { meals: [] }, ck = d.checkin || {}, t = consumed(d);
      const lifts = Object.keys(S.lifts[k] || {}).map(ex => ex + ": " + loggedSets(k, ex).map(s => (s.w || "?") + "x" + s.r).join(" ")).filter(x => !/: $/.test(x)).join("; ");
      return [k, d.weight, d.steps, d.water, d.sleepHrs, ck.n, ck.i, ck.s, t.cal || "", t.cal ? Math.round(t.p) : "", t.cal ? Math.round(t.c) : "", t.cal ? Math.round(t.f) : "", d.workout || "", lifts].map(csvCell).join(",");
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.join(",")].concat(rows).join("\n")], { type: "text/csv" }));
    a.download = "my-fitness-data-" + realToday + ".csv"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------- rest timer ---------- */
  const restOn = () => { try { return localStorage.getItem("restTimer") !== "off"; } catch (e) { return true; } };
  const rest = { end: 0, total: 0, iv: null, done: false };
  function restEl() {
    let el = document.getElementById("resttimer");
    if (!el) { el = document.createElement("div"); el.id = "resttimer"; el.hidden = true; document.body.appendChild(el); }
    return el;
  }
  function restDraw() {
    const el = restEl(), left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
    if (rest.done) { el.innerHTML = `<span class="rt-go">Rest over. Next set!</span><button data-act="restskip">Dismiss</button>`; return; }
    const m = Math.floor(left / 60), s = String(left % 60).padStart(2, "0");
    el.innerHTML = `<span class="rt-l">Rest</span><span class="rt-t">${m}:${s}</span><button data-act="restminus">-15s</button><button data-act="restplus">+15s</button><button data-act="restskip">Skip</button>
      <i style="width:${rest.total ? Math.round((1 - left / rest.total) * 100) : 0}%"></i>`;
  }
  function restStop() { clearInterval(rest.iv); rest.iv = null; rest.done = false; restEl().hidden = true; }
  function restBeep() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = new AC(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.08; o.start(); o.stop(c.currentTime + 0.35);
    } catch (e) {}
  }
  function restStart(sec) {
    if (ctx.readOnly || !restOn()) return;
    rest.total = sec; rest.end = Date.now() + sec * 1000; rest.done = false;
    restEl().hidden = false; restDraw();
    clearInterval(rest.iv);
    rest.iv = setInterval(() => {
      if (Date.now() >= rest.end) { clearInterval(rest.iv); rest.done = true; restDraw(); restBeep(); setTimeout(() => { if (rest.done) restStop(); }, 6000); }
      else restDraw();
    }, 500);
  }

  /* ---------- render & events ---------- */
  function render() {
    if (tab === "meals") loadSaved();
    const views = { home: viewHome, training: viewTraining, nutrition: viewNutrition, meals: viewMeals, notes: viewNotes, progress: viewProgress, streaks: viewStreaks };
    document.getElementById("view").innerHTML = views[tab]();
    const hl = tab === "progress" || tab === "streaks" ? "home" : tab;
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === hl));
    hydratePhotos().catch(() => {});
    document.body.classList.toggle("noscroll", (tab === "meals" && fs.open && !ctx.readOnly) || (tab === "training" && !!howEx));
    if (tab === "meals" && fs.open && fs.focus) { fs.focus = false; const q = document.getElementById("fq"); if (q) q.focus(); }
  }

  document.addEventListener("click", e => {
    if (e.target.classList && e.target.classList.contains("sheet-ov")) { fs.open = false; fs.sel = null; fs.manual = false; howEx = null; render(); return; }
    if (e.target.closest("input, textarea, select")) return;
    const t = e.target.closest("[data-tab],[data-act],[data-go]");
    if (!t) return;
    if (t.dataset.tab || t.dataset.go) {
      tab = t.dataset.tab || t.dataset.go; fs.open = false; howEx = null; render(); window.scrollTo(0, 0);
      if (tab === "notes") refreshMsgs().then(() => { if (tab === "notes") { render(); } markRead(); }).catch(() => {});
      return;
    }
    if (t.dataset.act === "logout") { ctx.logout(); return; }
    if (t.dataset.act === "tocoach") { ctx.switchToCoach(); return; }
    if (t.dataset.act === "mydata") { myData(); return; }
    if (t.dataset.act === "fscan") { openScanner(); return; }
    if (t.dataset.act === "restskip") { restStop(); return; }
    if (t.dataset.act === "restplus") { rest.end += 15000; rest.total += 15; restDraw(); return; }
    if (t.dataset.act === "restminus") { rest.end = Math.max(Date.now() + 1000, rest.end - 15000); restDraw(); return; }
    if (t.dataset.act === "installx") { try { localStorage.setItem("installHint", "1"); } catch (e) {} render(); return; }
    if (t.dataset.act === "installgo") { if (window.__bip) { window.__bip.prompt(); window.__bip = null; } render(); return; }
    if (t.dataset.act === "resttoggle") { try { localStorage.setItem("restTimer", restOn() ? "off" : "on"); } catch (e) {} if (!restOn()) restStop(); render(); return; }
    if (ctx.readOnly && !["prev", "next", "ciopen", "ciclose", "fpick", "fcancel", "foff", "how", "hclose"].includes(t.dataset.act)) return;
    if (t.dataset.act === "setpw") { changePassword(); return; }
    if (t.dataset.act === "sendmsg") { sendMsg(); return; }
    const d = dayRec(date);
    switch (t.dataset.act) {
      case "prev": { const x = toDate(date); x.setDate(x.getDate() - 1); date = iso(x); break; }
      case "next": { const x = toDate(date); x.setDate(x.getDate() + 1); if (iso(x) <= realToday) date = iso(x); break; }
      case "meal": d.meals[+t.dataset.i] = !d.meals[+t.dataset.i]; save(); break;
      case "water": d.water = Math.max(0, (d.water || 0) + (+t.dataset.v)); save(); break;
      case "rate": { d.checkin = d.checkin || {}; const k = t.dataset.k, v = +t.dataset.v; d.checkin[k] = d.checkin[k] === v ? null : v; save(); break; }
      case "wtype": d.workout = t.dataset.v; save(); break;
      case "liftall": e.preventDefault(); showAllLifts = !showAllLifts; break;
      case "how": howEx = t.dataset.ex; break;
      case "hclose": howEx = null; break;
      case "delphoto": if (confirm("Delete this photo?")) deletePhoto(t.dataset.d, t.dataset.p); return;
      case "swapopen": swapOpen[+t.dataset.i] = !swapOpen[+t.dataset.i]; break;
      case "mealopt": { const i = +t.dataset.i, v = t.dataset.v; d.mv = d.mv || {}; d.mv[i] = v === "c" ? "c" : +v; if (v === "c") d.custom = d.custom || {}; save(); break; }
      case "fpick": { const src = t.dataset.src, i = +t.dataset.i; const list = src === "l" ? localFoods(fs.q) : fs.off; fs.sel = list[i] || null; fs.unit = "g"; fs.amt = ""; fs.manual = false; break; }
      case "fcancel": fs.sel = null; break;
      case "sadd": {
        const m = (saved || []).find(x => String(x.id) === t.dataset.id); if (!m) return;
        d.foods = d.foods || [];
        d.foods.push({ slot: curSlot(), n: m.name, amt: "saved meal", g: 0, cal: Math.round(m.cal), p: r1(m.p), f: r1(m.f), c: r1(m.c) });
        savedNote = ""; fs.open = false; save(); break;
      }
      case "ssave": {
        const x = (d.foods || [])[+t.dataset.i]; if (!x) return;
        if ((saved || []).some(m => m.name === x.n && Math.round(m.cal) === Math.round(x.cal))) { savedNote = "Already saved."; break; }
        savedNote = "Saving...";
        ctx.sb.from("saved_meals").insert({ user_id: ctx.userId, name: x.n, cal: x.cal, p: x.p, f: x.f, c: x.c }).select("id,name,cal,p,f,c").single().then(({ data, error }) => {
          if (error) savedNote = "Couldn't save that. Try again."; else { saved = [data].concat(saved || []); savedNote = "Saved. You'll find it under your saved meals."; }
          const y = window.scrollY; render(); window.scrollTo(0, y);
        });
        break;
      }
      case "sdel": {
        const id = t.dataset.id; if (!confirm("Delete this saved meal?")) return;
        saved = (saved || []).filter(m => String(m.id) !== id); savedNote = "";
        ctx.sb.from("saved_meals").delete().eq("id", id).then(() => {});
        break;
      }
      case "fslot": fs.slot = t.dataset.v; break;
      case "frepeat": { d.foods = (d.foods || []).concat(yesterdayFoods().map(f => Object.assign({}, f))); fs.open = false; save(); break; }
      case "frecent": { const f = recentFoods(12)[+t.dataset.i]; if (!f) return; d.foods = d.foods || []; d.foods.push(Object.assign({}, f, { slot: curSlot() })); fs.open = false; save(); break; }
      case "fopen": fs.open = true; fs.tab = "search"; fs.focus = true; fs.sel = null; fs.manual = false; if (t.dataset.slot) fs.slot = t.dataset.slot; break;
      case "fclose": fs.open = false; fs.sel = null; fs.manual = false; break;
      case "ftab": fs.tab = t.dataset.v; fs.sel = null; fs.manual = t.dataset.v === "manual"; fs.focus = t.dataset.v === "search"; break;
      case "fmopen": fs.manual = true; fs.sel = null; break;
      case "fmclose": fs.manual = false; fs.man = {}; fs.tab = "search"; break;
      case "fmadd": {
        const m = fs.man, p = +m.p || 0, c = +m.c || 0, f = +m.f || 0;
        const cal = m.cal !== "" && m.cal != null && !isNaN(+m.cal) ? Math.round(+m.cal) : Math.round(p * 4 + c * 4 + f * 9);
        if (!cal && !p && !c && !f) return;
        d.foods = d.foods || [];
        d.foods.push({ slot: curSlot(), n: (m.n || "").trim() || "Quick add", amt: "entered by hand", g: 0, cal, p: r1(p), f: r1(f), c: r1(c) });
        fs.manual = false; fs.man = {}; fs.open = false; save(); break;
      }
      case "foff": searchOff(); return;
      case "fadd": {
        const x = foodCalc(); if (!x) return;
        d.foods = d.foods || [];
        d.foods.push({ slot: curSlot(), n: fs.sel.n, amt: fs.amt + " " + (fs.unit.length > 22 ? fs.unit.split(" (")[0] : fs.unit), g: x.g, cal: x.cal, p: x.p, f: x.f, c: x.c });
        fs.sel = null; fs.q = ""; fs.off = []; fs.offMsg = ""; fs.amt = ""; fs.open = false; save(); break;
      }
      case "fdel": if (d.foods) { d.foods.splice(+t.dataset.i, 1); save(); } break;
      case "ciopen": checkinOpen = true; break;
      case "ciclose": checkinOpen = false; break;
      case "offplan": d.offPlan = d.offPlan || {}; d.offPlan.on = !d.offPlan.on; save(); break;
    }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });

  async function changePassword() {
    const a = document.getElementById("pw1").value, b = document.getElementById("pw2").value;
    pwOk = false;
    if (a.length < 8) pwMsg = "Use at least 8 characters.";
    else if (a !== b) pwMsg = "The two passwords don't match.";
    else {
      const { error } = await ctx.sb.auth.updateUser({ password: a });
      if (error) pwMsg = error.message;
      else { pwOk = true; pwMsg = "Password updated. Use it next time you log in."; }
    }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }

  document.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.f === "fq") { fs.q = t.value; fs.off = []; fs.offMsg = ""; refreshFood(); }
    else if (t.dataset.f === "fm") { fs.man[t.dataset.k] = t.dataset.k === "n" ? t.value : t.value; }
    else if (t.dataset.f === "famt") { fs.amt = t.value; const el = document.getElementById("fprev"); if (el) el.innerHTML = foodPreview(); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.id === "fq") { e.preventDefault(); searchOff(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches('[data-act="meal"]')) { e.preventDefault(); e.target.click(); }
  });

  document.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.f === "funit") { fs.unit = t.value; const el = document.getElementById("fprev"); if (el) el.innerHTML = foodPreview(); return; }
    if (ctx.readOnly) return;
    if (t.dataset.phAngle) { const f = t.files && t.files[0]; if (f) uploadPhoto(f, t.dataset.phAngle); t.value = ""; return; }
    const d = dayRec(date);
    if (t.dataset.f === "weight") { d.weight = parseFloat(t.value) || null; save(); render(); return; }
    if (t.dataset.f === "sleep") { const v = parseFloat(t.value); d.sleepHrs = v > 0 && v <= 24 ? Math.round(v * 4) / 4 : null; save(); render(); return; }
    if (t.dataset.f === "steps") { d.steps = parseInt(t.value, 10) || null; save(); render(); return; }
    if (t.dataset.f === "cust") {
      const i = +t.dataset.i, k = t.dataset.k;
      d.custom = d.custom || {}; d.custom[i] = d.custom[i] || {};
      d.custom[i][k] = k === "note" ? t.value : (parseFloat(t.value) || 0);
      d.meals[i] = true; save();
      const y = window.scrollY; render(); window.scrollTo(0, y); return;
    }
    if (t.dataset.f === "offnote") { d.offPlan = d.offPlan || {}; d.offPlan.note = t.value; save(); return; }
    if (t.dataset.f === "msg") { d.msg = t.value; save(); return; }
    if (t.dataset.lift !== undefined) {
      const ex = C.workouts[workoutFor(date)][+t.dataset.lift];
      S.lifts[date] = S.lifts[date] || {};
      const arr = S.lifts[date][ex] = S.lifts[date][ex] || [];
      const s = +t.dataset.set;
      arr[s] = arr[s] || {};
      arr[s][t.dataset.fld] = t.value;
      if (t.dataset.fld === "r" && t.value) restStart(C.restSec || 90);
      save();
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
  });

  { const mb = document.querySelector('#tabs [data-tab="meals"]'); if (mb) mb.querySelector("span").textContent = C.meals.length ? "Meals" : "Food"; }
  function showWelcome() {
    if (ctx.readOnly || ctx.isSelf || Object.keys(S.days).length > 3) return;
    const key = "welcomed_" + ctx.userId;
    try { if (localStorage.getItem(key)) return; } catch (e) { return; }
    const el = document.createElement("div");
    el.className = "welcome"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Welcome");
    const steps = [
      ["Home", "Your day at a glance. Weigh in each morning, log your steps and sleep, and do your daily check-in at night."],
      [C.meals.length ? "Meals" : "Food", C.meals.length ? "Tap each meal when you eat it. Ate something different? Use Swap, or search any food and enter the weight." : "Search each food you eat, enter the weight, and your calories and macros add up through the day."],
      ["Training", "Log your weight and reps for each set. The app shows what you did last time so you know what to beat."],
      ["Notes", "Message your coach any time. Hunger, soreness, travel, questions. They see it."]
    ];
    el.innerHTML = `<div class="wcard"><div class="eyebrow">Welcome</div><h2 style="margin:0 0 10px">Hi ${esc(C.name || "there")}, here's how this works</h2>
      ${steps.map((s, i) => `<div class="wstep"><b>${i + 1}</b><div><strong>${esc(s[0])}</strong><div class="muted small">${esc(s[1])}</div></div></div>`).join("")}
      <div class="muted small" style="margin:10px 0">Tip: add this app to your home screen so it opens like a normal app.</div>
      <button class="btn" style="width:100%" id="welcomeok">Let's go</button></div>`;
    document.body.appendChild(el);
    document.getElementById("welcomeok").onclick = () => { try { localStorage.setItem(key, "1"); } catch (e) {} el.remove(); };
  }

  render();
  showWelcome();
  updateDot();
};
