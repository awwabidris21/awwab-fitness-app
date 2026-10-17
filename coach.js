window.startCoach = function (ctx) {
  const sb = ctx.sb;
  const view = document.getElementById("view");
  document.getElementById("app").style.maxWidth = "760px";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const toDate = k => new Date(k + "T12:00:00");
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  const today = iso(new Date());
  const yesterday = iso(daysAgo(1));
  const short = k => toDate(k).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  let clients = [], configs = {}, logs = {}, selected = null, notice = "";

  async function loadAll() {
    const [p, c, l] = await Promise.all([
      sb.from("profiles").select("id,name,role").eq("role", "client").order("name"),
      sb.from("client_config").select("user_id,config"),
      sb.from("day_logs").select("user_id,log_date,day,lifts").gte("log_date", iso(daysAgo(30))).order("log_date", { ascending: false })
    ]);
    const err = p.error || c.error || l.error;
    if (err) { notice = "Could not load data: " + err.message; return; }
    clients = p.data || [];
    configs = {}; (c.data || []).forEach(r => { configs[r.user_id] = r.config || {}; });
    logs = {}; (l.data || []).forEach(r => { (logs[r.user_id] = logs[r.user_id] || {})[r.log_date] = { day: r.day || {}, lifts: r.lifts || {} }; });
  }

  const rec = (id, k) => (logs[id] && logs[id][k]) || { day: {}, lifts: {} };
  const scoreOf = d => { const c = d.checkin || {}; return c.n && c.i && c.s ? c : null; };
  const sessionName = (cfg, k, d) => d.workout || (cfg.schedule ? cfg.schedule[toDate(k).getDay()] : "");
  const exDone = (cfg, k, r) => {
    const wk = sessionName(cfg, k, r.day);
    const exs = (cfg.workouts && cfg.workouts[wk]) || [];
    return { wk, total: exs.length, done: exs.filter(ex => (r.lifts[ex] || []).some(s => s && s.r)).length };
  };
  const lastWeight = id => {
    const ks = Object.keys(logs[id] || {}).filter(k => logs[id][k].day.weight).sort();
    return ks.length ? { w: logs[id][ks[ks.length - 1]].day.weight, k: ks[ks.length - 1] } : null;
  };

  function flagsFor(id) {
    const f = [];
    const y = rec(id, yesterday).day, t = rec(id, today).day;
    if (!scoreOf(y) && !scoreOf(t)) f.push("No check-in yesterday or today");
    [[yesterday, y], [today, t]].forEach(([k, d]) => {
      const s = scoreOf(d);
      if (s && s.n <= 2) f.push(short(k) + ": nutrition " + s.n);
      if (s && s.s <= 2) f.push(short(k) + ": sleep " + s.s);
      if (d.offPlan && d.offPlan.on) f.push(short(k) + ": ate off plan");
      if (d.msg) f.push(short(k) + ": message from client");
    });
    return f;
  }

  function topbar(title, sub, back) {
    return `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div>
      <div class="btns" style="margin:0">${back ? `<button class="btn ghost" data-c="back">Back</button>` : ""}<button class="btn ghost" data-c="logout">Log out</button></div></div>`;
  }

  function viewList() {
    let h = topbar("Your clients", "Coach view") + (notice ? `<div class="card note" style="margin-top:12px">${esc(notice)}</div>` : "");
    if (!clients.length) {
      h += `<div class="card" style="margin-top:16px"><h3>No clients yet</h3>
        <div>Add a client in Supabase: <b>Authentication, Users, Add user</b>. Use their email and a password you give them, and check "Auto Confirm User". Once they log in to the app for the first time, they show up here.</div></div>`;
    }
    h += clients.map(c => {
      const cfg = configs[c.id];
      const r = rec(c.id, today), d = r.day;
      const lw = lastWeight(c.id);
      const f = flagsFor(c.id);
      let status = `<div class="muted small" style="margin-top:6px">Plan not set up yet. Open to set it up.</div>`;
      if (cfg && cfg.meals) {
        const ex = exDone(cfg, today, r);
        const chip = (label, done) => `<span class="chip ${done ? "done" : ""}">${label}</span>`;
        status = `<div class="tasks">${chip("Meals " + (d.meals || []).filter(Boolean).length + "/" + cfg.meals.length, (d.meals || []).filter(Boolean).length === cfg.meals.length)}
          ${chip("Weigh-in" + (d.weight ? " " + d.weight : ""), !!d.weight)}${chip("Water " + (d.water || 0), (d.water || 0) >= ((cfg.targets || {}).water || 120))}
          ${chip("Steps" + (d.steps ? " " + d.steps : ""), !!d.steps)}${chip("Check-in", !!scoreOf(d))}${ex.wk && ex.wk !== "Rest" ? chip(ex.wk + " " + ex.done + "/" + ex.total, ex.total > 0 && ex.done === ex.total) : ""}</div>`;
      }
      return `<div class="card" style="margin-top:12px"><div class="rowline"><h3 style="color:var(--ink)">${esc(c.name || "Client")}</h3>
        <button class="btn" data-c="open" data-id="${esc(c.id)}">Open</button></div>
        <div class="muted small">${lw ? "Last weigh-in " + esc(lw.w) + " lbs (" + short(lw.k) + ")" : "No weigh-ins yet"}</div>${status}
        ${f.map(x => `<span class="flag">${esc(x)}</span>`).join("")}</div>`;
    }).join("");
    return h;
  }

  function viewClient() {
    const c = clients.find(x => x.id === selected);
    const cfg = configs[selected];
    let h = topbar(c.name || "Client", "Client", true) + (notice ? `<div class="card note" style="margin-top:12px">${esc(notice)}</div>` : "");

    if (!cfg || !cfg.meals) {
      return h + `<div class="card" style="margin-top:16px"><h3>Set up this client's plan</h3>
        <div class="muted small" style="margin-bottom:10px">Starts them on Abu Bakr's plan as a template. You can change every number after.</div>
        <button class="btn" data-c="template">Set up from template</button></div>`;
    }

    // recent days
    const ks = Object.keys(logs[selected] || {}).sort().reverse().slice(0, 14);
    const rows = ks.map(k => {
      const r = logs[selected][k], d = r.day, s = scoreOf(d) || {};
      const ex = exDone(cfg, k, r);
      const low = v => (v && v <= 2 ? "low" : "");
      const notes = [(d.offPlan && d.offPlan.on) ? "Off plan: " + (d.offPlan.note || "") : "", d.msg ? "Message: " + d.msg : ""].filter(Boolean).join(" | ");
      return `<tr><td>${short(k)}</td><td>${d.weight || "-"}</td><td>${d.water || 0}</td><td>${d.steps || "-"}</td>
        <td class="${low(s.n)}">${s.n || "-"}</td><td>${s.i || "-"}</td><td class="${low(s.s)}">${s.s || "-"}</td><td>${s.h || "-"}/${s.e || "-"}</td>
        <td>${(d.meals || []).filter(Boolean).length}/${(cfg.meals || []).length}</td><td>${esc(ex.wk || "")}${ex.total ? " " + ex.done + "/" + ex.total : ""}</td><td>${esc(notes)}</td></tr>`;
    }).join("");
    h += `<h2>Last 14 days</h2><div class="card"><div class="tablewrap"><table class="log"><thead><tr><th>Date</th><th>Wt</th><th>Water</th><th>Steps</th><th>Nut</th><th>Int</th><th>Slp</th><th>Hun/En</th><th>Meals</th><th>Workout</th><th>Notes</th></tr></thead><tbody>${rows || `<tr><td colspan="11" class="muted">No logs yet.</td></tr>`}</tbody></table></div></div>`;

    // lifts
    const liftDays = Object.keys(logs[selected] || {}).filter(k => Object.keys(logs[selected][k].lifts).length).sort().reverse().slice(0, 5);
    h += `<h2>Recent lifts</h2>` + (liftDays.map(k => {
      const r = logs[selected][k];
      const lines = Object.keys(r.lifts).filter(ex => (r.lifts[ex] || []).some(s => s && s.r)).map(ex =>
        `<div class="rowline small" style="margin-top:5px"><span>${esc(ex)}</span><span>${r.lifts[ex].filter(s => s && s.r).map(s => esc((s.w || "?") + " x " + s.r)).join(", ")}</span></div>`).join("");
      return `<div class="card"><h3>${short(k)} - ${esc(sessionName(cfg, k, r.day))}</h3>${lines}</div>`;
    }).join("") || `<div class="card muted">No lifts logged yet.</div>`);

    // plan editor
    const T = cfg.targets || {}, rv = cfg.weeklyReview || {};
    const num = (id, label, v) => `<div><label class="field" for="${id}">${label}</label><input id="${id}" type="number" inputmode="numeric" value="${esc(v)}"></div>`;
    h += `<h2>Edit plan</h2><div class="card">
      <label class="field" for="ed-name">Name</label><input id="ed-name" type="text" value="${esc(c.name)}">
      <h3 style="margin-top:18px">Program</h3>
      <div class="grid2"><div><label class="field" for="ed-start">Start date</label><input id="ed-start" type="date" value="${esc(cfg.startDate || "")}"></div>${num("ed-weeks", "Total weeks", cfg.totalWeeks)}
        ${num("ed-sw", "Start weight (lbs)", cfg.startWeight)}${num("ed-gw", "Goal weight (lbs)", cfg.goalWeight)}${num("ed-sets", "Sets per exercise", cfg.sets)}${num("ed-reps", "Target reps", cfg.reps)}</div>
      <h3 style="margin-top:18px">Targets</h3>
      <div class="grid2">${num("ed-cal", "Calories", T.calories)}${num("ed-p", "Protein (g)", T.protein)}${num("ed-c", "Carbs (g)", T.carbs)}${num("ed-f", "Fat (g)", T.fat)}${num("ed-fc", "Fat ceiling (g)", T.fatCeiling)}${num("ed-w", "Water (oz)", T.water)}</div>
      <label class="field" for="ed-note" style="margin-top:12px">Note for today (client sees this)</label><textarea id="ed-note">${esc(cfg.coachNote || "")}</textarea>
      <label class="field" for="ed-title" style="margin-top:12px">Weekly review title</label><input id="ed-title" type="text" value="${esc(rv.title || "")}">
      <label class="field" for="ed-wins" style="margin-top:12px">Wins</label><textarea id="ed-wins">${esc(rv.wins || "")}</textarea>
      <label class="field" for="ed-focus" style="margin-top:12px">Focus this week</label><textarea id="ed-focus">${esc(rv.focus || "")}</textarea>
      <h3 style="margin-top:18px">Meals</h3>
      ${(cfg.meals || []).map((m, i) => `<div class="mealedit"><label class="field">${esc(m.name)} (one item per line)</label>
        <textarea id="ed-m${i}-items">${esc((m.items || []).join("\n"))}</textarea>
        <div class="grid2" style="margin-top:8px">${num(`ed-m${i}-p`, "Protein", m.p)}${num(`ed-m${i}-f`, "Fat", m.f)}${num(`ed-m${i}-c`, "Carbs", m.c)}${num(`ed-m${i}-cal`, "Calories", m.cal)}</div></div>`).join("")}
      <h3 style="margin-top:18px">Weekly schedule</h3>
      <div class="grid2">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((dn, i) => `<div><label class="field" for="ed-sch${i}">${dn}</label>
        <select id="ed-sch${i}">${Object.keys(cfg.workouts || {}).concat("Rest").map(o => `<option ${((cfg.schedule || [])[i] === o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`).join("")}</div>
      <h3 style="margin-top:18px">Exercises (one per line)</h3>
      ${Object.keys(cfg.workouts || {}).map((name, i) => `<label class="field" for="ed-wk${i}" style="margin-top:8px">${esc(name)}</label><textarea id="ed-wk${i}">${esc((cfg.workouts[name] || []).join("\n"))}</textarea>`).join("")}
      <div class="btns"><button class="btn" data-c="save">Save changes</button></div></div>`;
    return h;
  }

  function render() { view.innerHTML = selected ? viewClient() : viewList(); window.scrollTo(0, 0); }

  async function upsertConfig(id, cfg) {
    const { error } = await sb.from("client_config").upsert({ user_id: id, config: cfg, updated_at: new Date().toISOString() });
    if (error) { notice = "Could not save: " + error.message; return false; }
    configs[id] = cfg; return true;
  }

  const val = id => document.getElementById(id).value;
  const n = id => parseFloat(val(id)) || 0;

  view.addEventListener("click", async e => {
    const t = e.target.closest("[data-c]");
    if (!t) return;
    const a = t.dataset.c;
    if (a === "logout") { ctx.logout(); return; }
    if (a === "back") { selected = null; notice = ""; render(); return; }
    if (a === "open") { selected = t.dataset.id; notice = ""; render(); return; }
    if (a === "template") {
      const c = clients.find(x => x.id === selected);
      const cfg = JSON.parse(JSON.stringify(CLIENT)); cfg.name = c.name || cfg.name; cfg.startDate = today;
      notice = (await upsertConfig(selected, cfg)) ? "Plan created. Change anything below." : notice; render(); return;
    }
    if (a === "save") {
      const c = clients.find(x => x.id === selected);
      const cfg = JSON.parse(JSON.stringify(configs[selected]));
      const nm = val("ed-name").trim() || c.name;
      cfg.name = nm;
      cfg.targets = Object.assign({}, cfg.targets, { calories: n("ed-cal"), protein: n("ed-p"), carbs: n("ed-c"), fat: n("ed-f"), fatCeiling: n("ed-fc"), water: n("ed-w") });
      cfg.startDate = val("ed-start") || cfg.startDate;
      cfg.totalWeeks = n("ed-weeks") || cfg.totalWeeks; cfg.startWeight = n("ed-sw") || cfg.startWeight; cfg.goalWeight = n("ed-gw") || cfg.goalWeight;
      cfg.sets = n("ed-sets") || cfg.sets; cfg.reps = n("ed-reps") || cfg.reps;
      cfg.schedule = [0, 1, 2, 3, 4, 5, 6].map(i => val("ed-sch" + i));
      Object.keys(cfg.workouts).forEach((name, i) => { cfg.workouts[name] = val("ed-wk" + i).split("\n").map(x => x.trim()).filter(Boolean); });
      cfg.coachNote = val("ed-note");
      cfg.weeklyReview = { title: val("ed-title"), wins: val("ed-wins"), focus: val("ed-focus") };
      cfg.meals = cfg.meals.map((m, i) => Object.assign({}, m, { items: val(`ed-m${i}-items`).split("\n").map(x => x.trim()).filter(Boolean), p: n(`ed-m${i}-p`), f: n(`ed-m${i}-f`), c: n(`ed-m${i}-c`), cal: n(`ed-m${i}-cal`) }));
      const ok = await upsertConfig(selected, cfg);
      if (ok && nm !== c.name) { const r = await sb.from("profiles").update({ name: nm }).eq("id", selected); if (!r.error) c.name = nm; }
      notice = ok ? "Saved. The client sees it next time they open the app." : notice; render();
    }
  });

  view.innerHTML = `<div class="muted">Loading...</div>`;
  loadAll().then(render);
};
