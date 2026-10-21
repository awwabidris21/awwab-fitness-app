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
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const r1 = x => Math.round(x * 10) / 10;

  let clients = [], configs = {}, logs = {}, msgs = {}, selected = null, notice = "", selfProfile = { id: ctx.userId, name: "Me" };
  const loadedAt = Date.now(), loadedDay = today;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (iso(new Date()) !== loadedDay || Date.now() - loadedAt > 30 * 60 * 1000)) location.reload();
  });
  const person = id => clients.find(x => x.id === id) || (id === ctx.userId ? selfProfile : null);

  async function loadAll() {
    const [p, c, l, m] = await Promise.all([
      sb.from("profiles").select("id,name,role").eq("role", "client").order("name"),
      sb.from("client_config").select("user_id,config"),
      sb.from("day_logs").select("user_id,log_date,day,lifts").gte("log_date", iso(daysAgo(60))).order("log_date", { ascending: false }),
      sb.from("messages").select("id,client_id,sender,body,created_at,read").order("created_at", { ascending: true }).limit(600)
    ]);
    const err = p.error || c.error || l.error;
    if (err) { notice = "Could not load data: " + err.message; return; }
    clients = p.data || [];
    try { const me = await sb.from("profiles").select("id,name").eq("id", ctx.userId).maybeSingle(); if (me.data) selfProfile = me.data; } catch (e) {}
    configs = {}; (c.data || []).forEach(r => { configs[r.user_id] = r.config || {}; });
    logs = {}; (l.data || []).forEach(r => { (logs[r.user_id] = logs[r.user_id] || {})[r.log_date] = { day: r.day || {}, lifts: r.lifts || {} }; });
    msgs = {}; ((m && m.data) || []).forEach(x => { (msgs[x.client_id] = msgs[x.client_id] || []).push(x); });
  }

  const REPLY_TEMPLATES = [
    ["Great week", "Great work this week. Your consistency is showing. Keep it going."],
    ["Weigh-in reminder", "Quick reminder to log your weigh-in and steps today so I can see your trend."],
    ["Sleep check", "How has your sleep been? Aim for 7 to 9 hours. It makes a big difference to recovery."],
    ["Log your food", "Let's tighten up food logging this week. Log everything, even the small stuff, so we can see what's really happening."],
    ["Protein", "Nice work hitting your protein. That's the biggest lever for results, so keep it up."],
    ["Check in", "Haven't seen a check-in from you in a couple of days. Everything okay? Let me know how I can help."]
  ];
  function weightChartCard(id) {
    const pts = weightSeries(id);
    if (pts.length < 2) return "";
    const W = 320, H = 120, P = 22, xs = pts.map(p => toDate(p.date).getTime()), ys = pts.map(p => p.w);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
    const X = t => P + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - 2 * P), Y = v => H - P - (v - lo) / (hi - lo || 1) * (H - 2 * P);
    const line = pts.map((p, i) => (i ? "L" : "M") + r1(X(toDate(p.date).getTime())) + " " + r1(Y(p.w))).join(" ");
    const avgPts = pts.map(p => { const t = toDate(p.date).getTime(), w = pts.filter(q => { const u = toDate(q.date).getTime(); return u <= t && u > t - 7 * 864e5; }); return { t, v: avg(w.map(q => q.w)) }; });
    const avgLine = avgPts.map((p, i) => (i ? "L" : "M") + r1(X(p.t)) + " " + r1(Y(p.v))).join(" ");
    const first = pts[0], last = pts[pts.length - 1];
    return `<h2>Weight</h2><div class="card"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Weight over time">
      <path d="${line}" fill="none" stroke="var(--amber)" stroke-width="2"/><path d="${avgLine}" fill="none" stroke="var(--slate)" stroke-width="2" stroke-dasharray="4 3"/>
      ${pts.map(p => `<circle cx="${r1(X(toDate(p.date).getTime()))}" cy="${r1(Y(p.w))}" r="2.6" fill="var(--amber)"/>`).join("")}
      <text x="2" y="12" font-size="10" fill="var(--slate)">${hi}</text><text x="2" y="${H - P - 2}" font-size="10" fill="var(--slate)">${lo}</text>
      <text x="${W - 4}" y="${H - 6}" font-size="10" text-anchor="end" fill="var(--slate)">${short(last.date)}</text><text x="${P}" y="${H - 6}" font-size="10" fill="var(--slate)">${short(first.date)}</text></svg>
      <div class="muted small">${first.w} lbs on ${short(first.date)} to ${last.w} lbs on ${short(last.date)} (${r1(last.w - first.w) > 0 ? "+" : ""}${r1(last.w - first.w)}). Dashed line is the 7-day average.</div></div>`;
  }

  /* ---------- export & backup ---------- */
  function download(name, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  async function fetchAll(table, cols, build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select(cols);
      if (build) q = build(q);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function dayCalories(cfg, d) {
    let t = { cal: 0, p: 0, f: 0, c: 0 };
    (cfg.meals || []).forEach((m, i) => {
      if (!(d.meals || [])[i]) return;
      const v = (d.mv || {})[i];
      let x = m;
      if (v === "c") x = (d.custom || {})[i] || {};
      else if (v >= 1 && m.swaps && m.swaps[v - 1]) x = m.swaps[v - 1];
      t.cal += +x.cal || 0; t.p += +x.p || 0; t.f += +x.f || 0; t.c += +x.c || 0;
    });
    (d.foods || []).forEach(x => { t.cal += +x.cal || 0; t.p += +x.p || 0; t.f += +x.f || 0; t.c += +x.c || 0; });
    return t;
  }
  async function exportCsv(id) {
    const c = clients.find(x => x.id === id), cfg = configs[id] || {};
    notice = "Preparing the download..."; render(true);
    try {
      const rows = await fetchAll("day_logs", "log_date,day,lifts", q => q.eq("user_id", id).order("log_date", { ascending: true }));
      const head = ["date", "weight_lbs", "steps", "water_oz", "sleep_hours", "nutrition_1to5", "intensity_1to5", "sleep_1to5", "hunger", "energy", "calories", "protein_g", "carbs_g", "fat_g", "session", "lifts", "off_plan", "note"];
      const lines = [head.join(",")];
      rows.forEach(r => {
        const d = r.day || {}, ck = d.checkin || {}, t = dayCalories(cfg, d);
        const lifts = Object.keys(r.lifts || {}).map(ex => ex + ": " + (r.lifts[ex] || []).filter(s => s && s.r).map(s => (s.w || "?") + "x" + s.r).join(" ")).filter(x => !/: $/.test(x)).join("; ");
        lines.push([r.log_date, d.weight, d.steps, d.water, d.sleepHrs, ck.n, ck.i, ck.s, ck.h, ck.e, t.cal || "", t.cal ? Math.round(t.p) : "", t.cal ? Math.round(t.c) : "", t.cal ? Math.round(t.f) : "", d.workout || sessionName(cfg, r.log_date, d), lifts, d.offPlan && d.offPlan.on ? "yes" : "", (d.offPlan && d.offPlan.note) || d.msg || ""].map(csvCell).join(","));
      });
      download(((c && c.name) || "client").toLowerCase().replace(/\s+/g, "-") + "-data-" + today + ".csv", lines.join("\n"), "text/csv");
      notice = "Downloaded " + rows.length + " days of data.";
    } catch (e) { notice = "Couldn't download: " + (e.message || e); }
    render(true);
  }
  async function backupAll() {
    notice = "Preparing your backup..."; render(true);
    try {
      const [profiles, client_config, day_logs, messages] = await Promise.all([
        fetchAll("profiles", "*", q => q.order("id")), fetchAll("client_config", "*", q => q.order("user_id")),
        fetchAll("day_logs", "*", q => q.order("log_date")), fetchAll("messages", "*", q => q.order("id"))
      ]);
      download("awwab-fitness-backup-" + today + ".json", JSON.stringify({ exported: new Date().toISOString(), profiles, client_config, day_logs, messages }, null, 1), "application/json");
      notice = "Backup downloaded: " + day_logs.length + " daily logs, " + messages.length + " messages, " + client_config.length + " plans. Keep the file somewhere safe.";
    } catch (e) { notice = "Couldn't make the backup: " + (e.message || e); }
    render(true);
  }

  /* ---------- data helpers ---------- */
  const rec = (id, k) => (logs[id] && logs[id][k]) || { day: {}, lifts: {} };
  const scoreOf = d => { const c = d.checkin || {}; return c.n && c.i && c.s ? c : null; };
  const sessionName = (cfg, k, d) => d.workout || (cfg.schedule ? cfg.schedule[toDate(k).getDay()] : "");
  const exDone = (cfg, k, r) => {
    const wk = sessionName(cfg, k, r.day);
    const exs = (cfg.workouts && cfg.workouts[wk]) || [];
    return { wk, total: exs.length, done: exs.filter(ex => (r.lifts[ex] || []).some(s => s && s.r)).length };
  };
  const topW = (r, ex) => Math.max(0, ...((r.lifts[ex] || []).filter(s => s && s.r).map(s => parseFloat(s.w) || 0)));
  const unreadFrom = id => (msgs[id] || []).filter(m => m.sender === "client" && !m.read);

  function weightSeries(id) {
    const cfg = configs[id] || {}, m = {};
    (cfg.weightLog || []).forEach(x => { m[x.date] = x.w; });
    Object.keys(logs[id] || {}).forEach(k => { if (logs[id][k].day.weight) m[k] = logs[id][k].day.weight; });
    return Object.keys(m).sort().map(k => ({ date: k, w: m[k] }));
  }
  const lastWeight = id => { const s = weightSeries(id); return s.length ? { w: s[s.length - 1].w, k: s[s.length - 1].date } : null; };
  const dateList = (endKey, n) => { const out = []; const d = toDate(endKey); for (let i = 0; i < n; i++) { out.unshift(iso(d)); d.setDate(d.getDate() - 1); } return out; };
  const mealTotals = cfg => (cfg.meals || []).reduce((a, m) => ({ cal: a.cal + (+m.cal || 0), p: a.p + (+m.p || 0), f: a.f + (+m.f || 0), c: a.c + (+m.c || 0) }), { cal: 0, p: 0, f: 0, c: 0 });
  const weekNumber = cfg => Math.max(1, Math.min(cfg.totalWeeks || 12, Math.floor((toDate(today) - toDate(cfg.startDate || today)) / 864e5 / 7) + 1));

  function flagsFor(id) {
    const f = [];
    const y = rec(id, yesterday).day, t = rec(id, today).day;
    if (!scoreOf(y) && !scoreOf(t)) f.push("No check-in yesterday or today");
    [[yesterday, y], [today, t]].forEach(([k, d]) => {
      const s = scoreOf(d);
      if (s && s.n <= 2) f.push(short(k) + ": nutrition " + s.n);
      if (s && s.s <= 2) f.push(short(k) + ": sleep " + s.s);
      if (d.offPlan && d.offPlan.on) f.push(short(k) + ": ate off plan");
    });
    const u = unreadFrom(id).length;
    if (u) f.push(u + " new message" + (u > 1 ? "s" : ""));
    return f;
  }

  /* ---------- call sheet ---------- */
  function callSheet(id) {
    const cfg = configs[id] || {};
    const y = rec(id, yesterday), d = y.day, sc = scoreOf(d);
    const lines = [], q = [];
    lines.push(sc ? `Yesterday: nutrition ${sc.n}, intensity ${sc.i}, sleep ${sc.s}` + (sc.h ? `, hunger ${sc.h}` : "") + (sc.e ? `, energy ${sc.e}` : "") : "No check-in yesterday.");
    const bits = [];
    if (d.weight) bits.push("weight " + d.weight);
    if (d.steps) bits.push(d.steps.toLocaleString() + " steps");
    if (d.sleepHrs) bits.push(d.sleepHrs + " h sleep");
    if (d.water) bits.push(d.water + " oz water");
    if ((cfg.meals || []).length) bits.push("meals " + (d.meals || []).filter(Boolean).length + "/" + cfg.meals.length);
    if ((d.foods || []).length) { const fc = d.foods.reduce((a, x) => a + (+x.cal || 0), 0); bits.push((cfg.meals || []).length ? d.foods.length + " extra food" + (d.foods.length > 1 ? "s" : "") + " logged (" + fc + " cal)" : d.foods.length + " food" + (d.foods.length > 1 ? "s" : "") + " logged, " + fc + " of " + ((cfg.targets || {}).calories || "?") + " cal"); }
    else if (!(cfg.meals || []).length) bits.push("no food logged");
    lines.push(bits.join(", ") || "Nothing logged yesterday.");
    const ex = exDone(cfg, yesterday, y);
    if (ex.wk === "Rest") lines.push("Rest day"); else if (ex.wk) lines.push(`${ex.wk}: ${ex.done}/${ex.total} exercises logged`);
    const tw = sessionName(cfg, today, rec(id, today).day);
    lines.push(`Today: ${tw || "no session"}` + ((cfg.targets || {}).calories ? `, ${cfg.targets.calories} cal` : ""));

    const missed = dateList(yesterday, 7).filter(k => !scoreOf(rec(id, k).day)).length;
    if (!sc) q.push(missed >= 3 ? `You've missed ${missed} of the last 7 check-ins. Is the text reaching you, or is the timing off?` : "You didn't check in yesterday. What got in the way?");
    else {
      if (sc.n <= 3) q.push(`Nutrition was a ${sc.n}. What was hardest: hunger, prep, or schedule?`);
      if (sc.s <= 3) q.push(`Sleep was a ${sc.s}. What time did you get to bed, and how many hours was it?`);
      if (sc.i <= 3 && ex.wk && ex.wk !== "Rest") q.push(`Intensity was a ${sc.i}. How did the session feel?`);
      if (sc.e && sc.e <= 2) q.push(`Energy was a ${sc.e}. Is that a sleep problem, a food problem, or just a hard week?`);
      if (sc.h && sc.h >= 4) q.push(`Hunger was a ${sc.h}. Which meal leaves you hungriest?`);
    }
    if (d.sleepHrs && d.sleepHrs < 6.5) q.push(`You logged ${d.sleepHrs} hours of sleep. What's keeping you up, and can we move your bedtime earlier?`);
    if (!d.steps || d.steps < 7000) q.push(d.steps ? `Steps were ${d.steps.toLocaleString()}. What's getting in the way of 10,000?` : "Steps weren't logged. How many did you get?");
    if (!d.weight) q.push("Did you weigh in yesterday?");
    const ws = weightSeries(id);
    if (ws.length >= 4) {
      const recent = ws.filter(x => toDate(x.date) > daysAgo(7)), prior = ws.filter(x => toDate(x.date) <= daysAgo(7) && toDate(x.date) > daysAgo(14));
      if (recent.length >= 2 && prior.length >= 2) {
        const chg = r1(avg(recent.map(x => x.w)) - avg(prior.map(x => x.w)));
        const cut = (cfg.goalWeight || 0) < (cfg.startWeight || 0);
        if (cut && chg > -0.3) q.push(`Your weight average is about flat this week (${chg > 0 ? "+" : ""}${chg} lb). How are hunger and the meals going?`);
        if (cut && chg < -3) q.push(`Your weight average dropped ${Math.abs(chg)} lb in a week, which is fast. How are your energy and hunger?`);
      }
    }
    if (d.offPlan && d.offPlan.on) q.push(`You marked off plan${d.offPlan.note ? `: "${d.offPlan.note}"` : ""}. Want to adjust a meal?`);
    if (ex.wk && ex.wk !== "Rest" && ex.total && ex.done < ex.total) q.push(`Did you train ${ex.wk}? Only ${ex.done} of ${ex.total} exercises were logged.`);
    const best = Object.keys((cfg.workouts || {})).flatMap(k => cfg.workouts[k]).filter(e => {
      const t = topW(y, e); if (!t) return false;
      const before = Math.max(0, ...Object.keys(logs[id] || {}).filter(k => k < yesterday).map(k => topW(logs[id][k], e)));
      return before && t > before;
    });
    if (best.length) q.push(`New best on ${best[0]}. Nice. How did it feel?`);
    unreadFrom(id).slice(-1).forEach(m => q.push(`They messaged: "${m.body.slice(0, 120)}${m.body.length > 120 ? "..." : ""}". Answer that.`));
    const lastPhoto = Object.keys(logs[id] || {}).filter(k => (logs[id][k].day.photos || []).length).sort().pop();
    if (lastPhoto && (toDate(today) - toDate(lastPhoto)) / 864e5 >= 7) q.push(`It's been ${Math.round((toDate(today) - toDate(lastPhoto)) / 864e5)} days since your progress photos. Can you take them today?`);
    return { lines, q: q.slice(0, 7) };
  }

  /* ---------- call brief: a scannable view of yesterday for the daily call ---------- */
  const STEP_GOAL = 10000, SLEEP_GOAL = 7;
  function brief(id) {
    const cfg = configs[id] || {}, T = cfg.targets || {}, y = rec(id, yesterday), d = y.day, sc = scoreOf(d);
    const rows = [], bad = [], well = [];
    const row = (label, val, st) => rows.push({ label, val, st });
    // weigh-in
    if (d.weight) { row("Weigh-in", d.weight + " lbs", "ok"); } else { row("Weigh-in", "Not logged", "bad"); bad.push("Didn't weigh in"); }
    // steps
    const st = d.steps || 0;
    if (st >= STEP_GOAL * 0.9) { row("Steps", st.toLocaleString(), "ok"); well.push("Steps " + st.toLocaleString()); }
    else if (st >= 7000) { row("Steps", st.toLocaleString() + " of " + STEP_GOAL.toLocaleString(), "mid"); bad.push("Steps " + st.toLocaleString() + " of " + STEP_GOAL.toLocaleString()); }
    else { row("Steps", st ? st.toLocaleString() + " of " + STEP_GOAL.toLocaleString() : "Not logged", "bad"); bad.push(st ? "Steps only " + st.toLocaleString() : "Steps not logged"); }
    // sleep
    const sh = d.sleepHrs || 0;
    if (sh >= SLEEP_GOAL) { row("Sleep", sh + " h", "ok"); well.push("Slept " + sh + " h"); }
    else if (sh >= 6) { row("Sleep", sh + " h", "mid"); bad.push("Slept only " + sh + " h"); }
    else { row("Sleep", sh ? sh + " h" : "Not logged", "bad"); bad.push(sh ? "Slept only " + sh + " h" : "Sleep not logged"); }
    // water
    const wt = T.water || 120, w = d.water || 0;
    if (w >= wt * 0.9) { row("Water", w + " oz", "ok"); } else if (w >= wt * 0.7) { row("Water", w + " of " + wt + " oz", "mid"); bad.push("Water " + w + " of " + wt + " oz"); }
    else { row("Water", w ? w + " of " + wt + " oz" : "Not logged", "bad"); bad.push(w ? "Water only " + w + " oz" : "Water not logged"); }
    // food
    const tot = dayCalories(cfg, d), cal = Math.round(tot.cal), pro = Math.round(tot.p), mealsN = (cfg.meals || []).length;
    if (!cal) { row("Food", mealsN ? "Nothing checked off" : "Nothing logged", "bad"); bad.push("No food logged"); }
    else {
      const r = T.calories ? cal / T.calories : 1, label = cal.toLocaleString() + (T.calories ? " / " + T.calories.toLocaleString() : "") + " cal" + (T.protein ? " \u00b7 P " + pro + "/" + T.protein + "g" : "");
      if (r >= 0.9 && r <= 1.1) { row("Food", label, "ok"); well.push("Calories on target (" + cal.toLocaleString() + ")"); }
      else if (r >= 0.75 && r <= 1.25) { row("Food", label, "mid"); bad.push(r < 1 ? "Calories under (" + cal.toLocaleString() + " of " + T.calories.toLocaleString() + ")" : "Calories over (" + cal.toLocaleString() + " of " + T.calories.toLocaleString() + ")"); }
      else { row("Food", label, "bad"); bad.push(r < 1 ? "Calories way under (" + cal.toLocaleString() + " of " + T.calories.toLocaleString() + ")" : "Calories way over (" + cal.toLocaleString() + " of " + T.calories.toLocaleString() + ")"); }
      if (T.protein) { if (pro >= T.protein * 0.9) well.push("Protein " + pro + "g"); else bad.push("Protein " + pro + " of " + T.protein + "g"); }
    }
    // training
    const ex = exDone(cfg, yesterday, y);
    if (ex.wk === "Rest" || !ex.wk) row("Training", "Rest day", "na");
    else if (ex.total && ex.done === ex.total) { row("Training", ex.wk + " " + ex.done + "/" + ex.total, "ok"); well.push("Finished " + ex.wk + " (" + ex.done + "/" + ex.total + ")"); }
    else if (ex.done > 0) { row("Training", ex.wk + " " + ex.done + "/" + ex.total, "mid"); bad.push(ex.wk + ": " + ex.done + " of " + ex.total + " exercises"); }
    else { row("Training", ex.wk + " 0/" + ex.total, "bad"); bad.push("Nothing logged for " + ex.wk); }
    // check-in
    if (!sc) { row("Check-in", "Not submitted", "bad"); bad.push("No check-in"); }
    else {
      const lo = Math.min(sc.n, sc.i, sc.s);
      row("Check-in", "Nutrition " + sc.n + " \u00b7 Intensity " + sc.i + " \u00b7 Sleep " + sc.s, lo >= 4 ? "ok" : lo === 3 ? "mid" : "bad");
      if (sc.n <= 2) bad.push("Rated nutrition " + sc.n); if (sc.i <= 2) bad.push("Rated intensity " + sc.i); if (sc.s <= 2) bad.push("Rated sleep " + sc.s);
      if (sc.h && sc.h >= 4) bad.push("Hunger " + sc.h + "/5"); if (sc.e && sc.e <= 2) bad.push("Energy " + sc.e + "/5");
    }
    if (d.offPlan && d.offPlan.on) bad.push("Ate off plan" + (d.offPlan.note ? ": " + d.offPlan.note : ""));
    // new bests
    Object.keys(cfg.workouts || {}).flatMap(k => cfg.workouts[k]).forEach(e => {
      const t = topW(y, e); if (!t) return;
      const before = Math.max(0, ...Object.keys(logs[id] || {}).filter(k => k < yesterday).map(k => topW(logs[id][k], e)));
      if (before && t > before) well.push("New best: " + e + " " + t + " lbs");
    });
    // 7-day trend
    const days = dateList(yesterday, 7), recs = days.map(k => rec(id, k).day);
    const ci = recs.filter(scoreOf).length, stepsA = recs.filter(x => x.steps).map(x => x.steps), sleepA = recs.filter(x => x.sleepHrs).map(x => x.sleepHrs);
    const trend = [ci + "/7 check-ins"];
    if (stepsA.length) trend.push("avg " + Math.round(avg(stepsA)).toLocaleString() + " steps");
    if (sleepA.length) trend.push("avg " + r1(avg(sleepA)) + " h sleep");
    const ws = weightSeries(id);
    const w1 = ws.filter(x => toDate(x.date) > daysAgo(7)), w0 = ws.filter(x => toDate(x.date) <= daysAgo(7) && toDate(x.date) > daysAgo(14));
    if (w1.length && w0.length) { const chg = r1(avg(w1.map(x => x.w)) - avg(w0.map(x => x.w))); trend.push("weight avg " + (chg > 0 ? "+" : "") + chg + " lb vs the week before"); }
    else if (ws.length) trend.push("weight " + ws[ws.length - 1].w + " lbs");
    // today
    const tw = sessionName(cfg, today, rec(id, today).day);
    const todayLine = (tw ? tw : "No session") + (T.calories ? " \u00b7 " + T.calories.toLocaleString() + " cal" + (T.protein ? " \u00b7 P " + T.protein + " / C " + (T.carbs || "?") + " / F " + (T.fat || "?") : "") : "");
    return { rows, bad, well, trend: trend.join(" \u00b7 "), today: todayLine, talk: callSheet(id).q };
  }

  /* private call notes live in the COACH's own config (clients can't read it), with a device fallback */
  const NOTES_KEY = "coachCallNotes";
  function notesFor(id) {
    const own = configs[ctx.userId];
    if (own && own.coachCallNotes) return own.coachCallNotes[id] || [];
    try { return (JSON.parse(localStorage.getItem(NOTES_KEY) || "{}")[id]) || []; } catch (e) { return []; }
  }
  async function saveNote(id, text) {
    const list = notesFor(id).filter(n => n.date !== today).concat(text ? [{ date: today, text }] : []).slice(-60);
    const own = configs[ctx.userId];
    if (own && own.meals) {
      const cfg = JSON.parse(JSON.stringify(own)); cfg.coachCallNotes = Object.assign({}, cfg.coachCallNotes, { [id]: list });
      return upsertConfig(ctx.userId, cfg);
    }
    try { const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); all[id] = list; localStorage.setItem(NOTES_KEY, JSON.stringify(all)); return true; } catch (e) { notice = "Couldn't save the note on this device."; return false; }
  }

  /* ---------- weekly report ---------- */
  function weekly(id) {
    const cfg = configs[id] || {};
    const days = dateList(yesterday, 7);
    const N = [], I = [], Sl = [], steps = [], water = [], sleepH = [];
    let ci = 0, mealSum = 0, mealDen = 0, wkSched = 0, wkDone = 0, off = 0;
    days.forEach(k => {
      const r = rec(id, k), d = r.day, s = scoreOf(d);
      if (s) { ci++; N.push(s.n); I.push(s.i); Sl.push(s.s); }
      if (d.steps) steps.push(d.steps);
      if (d.sleepHrs) sleepH.push(d.sleepHrs);
      if (d.water) water.push(d.water);
      mealDen += (cfg.meals || []).length; mealSum += (d.meals || []).filter(Boolean).length;
      const e = exDone(cfg, k, r); if (e.wk && e.wk !== "Rest" && e.total) { wkSched++; if (e.done === e.total) wkDone++; }
      if (d.offPlan && d.offPlan.on) off++;
    });
    const ws = weightSeries(id);
    const w1 = ws.filter(x => toDate(x.date) > daysAgo(7)), w0 = ws.filter(x => toDate(x.date) <= daysAgo(7) && toDate(x.date) > daysAgo(14));
    const wChange = w1.length && w0.length ? r1(avg(w1.map(x => x.w)) - avg(w0.map(x => x.w))) : null;
    const allEx = Object.keys(cfg.workouts || {}).flatMap(k => cfg.workouts[k]);
    const winSet = new Set(days);
    const prs = allEx.filter(e => {
      const inWin = Math.max(0, ...Object.keys(logs[id] || {}).filter(k => winSet.has(k)).map(k => topW(logs[id][k], e)));
      const before = Math.max(0, ...Object.keys(logs[id] || {}).filter(k => k < days[0]).map(k => topW(logs[id][k], e)));
      return before && inWin > before;
    });
    const mealPct = mealDen ? Math.round(mealSum / mealDen * 100) : 0;
    const foodDays = days.filter(k => (rec(id, k).day.foods || []).length).length;
    const stats = [
      ["Check-ins", ci + "/7"], mealDen ? ["Meals eaten", mealPct + "%"] : ["Days food logged", foodDays + "/7"],
      ["Nutrition", N.length ? r1(avg(N)) : "-"], ["Intensity", I.length ? r1(avg(I)) : "-"], ["Sleep", Sl.length ? r1(avg(Sl)) : "-"],
      ["Sleep hours (avg)", sleepH.length ? r1(avg(sleepH)) + " h" : "-"], ["Steps (avg)", steps.length ? Math.round(avg(steps)).toLocaleString() : "-"], ["Water (avg)", water.length ? Math.round(avg(water)) + " oz" : "-"],
      ["Workouts", wkSched ? wkDone + "/" + wkSched : "-"], ["Weight avg change", wChange == null ? "-" : (wChange > 0 ? "+" : "") + wChange + " lb"], ["New bests", String(prs.length)]
    ];
    const wins = [], focus = [];
    if (ci >= 6) wins.push(`You checked in ${ci} of 7 days.`);
    if (mealDen && mealPct >= 85) wins.push(`You hit ${mealPct}% of your meals.`);
    if (I.length && avg(I) >= 4.5) wins.push(`Training intensity averaged ${r1(avg(I))}.`);
    if (wChange != null && ((cfg.goalWeight || 0) < (cfg.startWeight || 0) ? wChange < 0 : wChange > 0)) wins.push(`Your weight average moved ${wChange > 0 ? "+" : ""}${wChange} lb, the right way.`);
    if (prs.length) wins.push(`${prs.length} new best${prs.length > 1 ? "s" : ""} in the gym, including ${prs[0]}.`);
    if (steps.length && avg(steps) >= 9000) wins.push(`Steps averaged ${Math.round(avg(steps)).toLocaleString()}.`);
    if (wkSched && wkDone === wkSched) wins.push("You finished every scheduled workout.");
    if (!wins.length) wins.push("You showed up and kept logging. That's the base everything else builds on.");
    if (ci < 5) focus.push("Check in every day, even if it's a bad day. It's how I help you.");
    if (N.length && avg(N) < 4) focus.push("Hit every meal. Nutrition is where the week slipped.");
    if (Sl.length && avg(Sl) < 4) focus.push("Protect your sleep. Aim for a steady bedtime.");
    if (steps.length && avg(steps) < 8000) focus.push("Get your steps up toward 10,000.");
    if (!focus.length) focus.push("Keep the same routine and add weight or a rep wherever you can.");
    const title = "Week " + weekNumber(cfg) + " review";
    const text = `${cfg.name || "Client"} - ${title}\n` + stats.map(s => `${s[0]}: ${s[1]}`).join("\n") + `\n\nWins: ${wins.join(" ")}\nFocus: ${focus.join(" ")}`;
    return { title, stats, wins: wins.join(" "), focus: focus.slice(0, 2).join(" "), text };
  }

  /* ---------- macros ---------- */
  function macroCalc(w, cal, fat) {
    const p = Math.round(0.8 * w), fc = Math.round(0.3 * w);
    const c = Math.max(0, Math.round((cal - 4 * p - 9 * fat) / 4));
    return { p, fc, c, f: fat, cal };
  }
  function macroPreview(id) {
    const cfg = configs[id], T = cfg.targets || {};
    const w = parseFloat(document.getElementById("mu-w").value) || 0, cal = parseFloat(document.getElementById("mu-cal").value) || 0, f = parseFloat(document.getElementById("mu-f").value) || 0;
    const out = document.getElementById("mu-out");
    if (!w || !cal) { out.innerHTML = `<div class="muted small">Enter a weight and calories.</div>`; return; }
    const n2 = macroCalc(w, cal, f), mt = mealTotals(cfg), diff = cal - mt.cal;
    const row = (l, a, b, u) => `<tr><td>${l}</td><td>${esc(a)}${u}</td><td><strong>${b}${u}</strong></td></tr>`;
    out.innerHTML = `<table class="log" style="min-width:0"><thead><tr><th></th><th>Now</th><th>New</th></tr></thead><tbody>
      ${row("Calories", T.calories, n2.cal, "")}${row("Protein", T.protein, n2.p, "g")}${row("Carbs", T.carbs, n2.c, "g")}${row("Fat", T.fat, n2.f, "g")}${row("Fat ceiling", T.fatCeiling, n2.fc, "g")}</tbody></table>
      ${(cfg.meals || []).length ? `<div class="muted small" style="margin-top:8px">Meal plan now adds up to <b>${mt.cal} cal</b> (P ${mt.p} / F ${mt.f} / C ${mt.c}). ${Math.abs(diff) <= 25 ? "That matches the new target." : `The new target is ${Math.abs(diff)} cal ${diff < 0 ? "lower" : "higher"}. After applying, adjust the meals below${diff < 0 ? ": trim dinner rice or potato first" : ""}.`}${Math.abs(n2.p - mt.p) > 6 ? ` Protein in the meals is ${mt.p}g vs the ${n2.p}g target.` : ""}</div>` : `<div class="muted small" style="margin-top:8px">No fixed meal plan: these are his daily targets for food logging.</div>`}`;
  }

  /* ---------- swaps (editor text <-> data) ---------- */
  const swapsToText = m => (m.swaps || []).map(s => `${s.name} :: ${(s.items || []).join("; ")} :: ${s.p}/${s.f}/${s.c}/${s.cal}`).join("\n");
  function textToSwaps(t) {
    return t.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const [name, items, nums] = l.split("::").map(x => (x || "").trim());
      const [p, f, c, cal] = (nums || "").split("/").map(x => parseFloat(x) || 0);
      return { name: name || "Swap", items: (items || "").split(";").map(x => x.trim()).filter(Boolean), p, f, c, cal };
    });
  }

  /* ---------- views ---------- */
  function topbar(title, sub, back) {
    return `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div>
      <div class="btns" style="margin:0">${back ? `<button class="btn ghost" data-c="back">Back</button>` : ""}<button class="btn ghost" data-c="myapp">My app</button><button class="btn ghost" data-c="logout">Log out</button></div></div>`;
  }

  const DOT = { ok: "good", mid: "mid", bad: "bad", na: "na" };
  // compact = the client list card; full = the client's page, with the whole brief and call notes
  function sheetHtml(id, full) {
    const b = brief(id);
    if (!full) {
      return `<div class="sheet"><div class="eyebrow" style="margin-bottom:4px">Yesterday</div>
        ${b.bad.length ? `<div>${b.bad.slice(0, 5).map(x => `<span class="flag">${esc(x)}</span>`).join("")}${b.bad.length > 5 ? `<span class="muted small"> +${b.bad.length - 5} more</span>` : ""}</div>` : `<div class="small"><b style="color:var(--good)">All on track.</b> Nothing missed.</div>`}
        <div class="muted small" style="margin-top:6px">Open for the full call brief.</div></div>`;
    }
    const notes = notesFor(id), last = notes.filter(n => n.date !== today).pop(), mine = notes.find(n => n.date === today);
    return `<div class="brief"><div class="eyebrow">Call brief \u00b7 yesterday, ${esc(short(yesterday))}</div>
      <div class="card" style="padding:6px 14px">${b.rows.map(r => `<div class="brow"><span class="bl"><i class="dot ${DOT[r.st]}"></i>${esc(r.label)}</span><span class="bv ${r.st}">${esc(r.val)}</span></div>`).join("")}</div>
      <div class="card"><div class="bh bad">Fell short</div>${b.bad.length ? `<ul class="bl2">${b.bad.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="small">Nothing. Great day.</div>`}
        <div class="bh good" style="margin-top:12px">Went well</div>${b.well.length ? `<ul class="bl2">${b.well.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="small muted">Nothing stood out. Find something to praise.</div>`}</div>
      <div class="card"><div class="bh">Talk about</div>${b.talk.length ? `<ol class="qs">${b.talk.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join("")}</ol>${b.talk.length > 3 ? `<details><summary class="muted small">${b.talk.length - 3} more</summary><ol class="qs" start="4">${b.talk.slice(3).map(x => `<li>${esc(x)}</li>`).join("")}</ol></details>` : ""}` : `<div class="small">Nothing flagged. Ask how they're feeling and what's coming up this week.</div>`}</div>
      <div class="card"><div class="small"><b>Today:</b> ${esc(b.today)}</div><div class="small" style="margin-top:4px"><b>Last 7 days:</b> ${esc(b.trend)}</div></div>
      <div class="card"><div class="bh">Call notes <span class="muted small" style="text-transform:none;letter-spacing:0">(private, only you see these)</span></div>
        ${last ? `<div class="small" style="margin:6px 0 10px"><b>Last call (${esc(short(last.date))}):</b> ${esc(last.text)}</div>` : ""}
        <textarea id="call-note" placeholder="What did you talk about? What did they commit to?">${esc(mine ? mine.text : "")}</textarea>
        <div class="btns"><button class="btn" data-c="savenote" data-id="${esc(id)}">Save notes</button><button class="btn ghost" data-c="copysheet" data-id="${esc(id)}">Copy brief</button></div></div></div>`;
  }

  // Which phase of the 12 weeks a client is in. Month 1 needs the most attention.
  function phaseOf(cfg) {
    if (!cfg || !cfg.startDate) return null;
    const wk = Math.floor((toDate(today) - toDate(cfg.startDate)) / 864e5 / 7) + 1;
    if (wk < 1) return { wk, label: "Starts " + short(cfg.startDate), cls: "" };
    if (wk > (cfg.totalWeeks || 12)) return { wk, label: "Program complete", cls: "" };
    const m = wk <= 4 ? 1 : wk <= 8 ? 2 : 3;
    return { wk, m, label: "Week " + wk + " of " + (cfg.totalWeeks || 12) + " \u00b7 Month " + m, cls: m === 1 ? "focus" : "" };
  }
  function viewList() {
    let h = topbar("Your clients", "Coach view") + (notice ? `<div class="card note" style="margin-top:12px">${esc(notice)}</div>` : "");
    if (!clients.length) {
      h += `<div class="card" style="margin-top:16px"><h3>No clients yet</h3>
        <div>Add a client in Supabase: <b>Authentication, Users, Add user</b>. Use their email and a password you give them, and check "Auto Confirm User". Once they log in to the app for the first time, they show up here.</div></div>`;
    }
    if (clients.length) {
      const live = clients.filter(x => configs[x.id] && configs[x.id].meals);
      const n = fn => live.filter(fn).length;
      const unread = live.reduce((a, x) => a + unreadFrom(x.id).length, 0);
      const quiet = live.filter(x => !Object.keys(logs[x.id] || {}).some(k => k >= iso(daysAgo(2)) && (logs[x.id][k].day.weight || logs[x.id][k].day.steps || (logs[x.id][k].day.foods || []).length || scoreOf(logs[x.id][k].day))));
      const attn = live.filter(x => flagsFor(x.id).length || quiet.includes(x));
      const cell = (l, v, s) => `<div class="wk"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
      h += `<div class="card wkcard" style="margin-top:16px">${cell("Weighed in", n(x => rec(x.id, today).day.weight) + "/" + live.length, "today")}${cell("Checked in", n(x => scoreOf(rec(x.id, today).day)) + "/" + live.length, "today")}${cell("Messages", unread, "unread")}${cell("Quiet", quiet.length, "no log in 2 days")}</div>`;
      if (attn.length) h += `<div class="card note"><div class="eyebrow">Needs your attention</div>${attn.map(x => esc(x.name || "Client") + (quiet.includes(x) ? " (quiet)" : "")).join(", ")}</div>`;
    }
    const ordered = clients.slice().sort((a, z) => ((configs[z.id] || {}).startDate || "").localeCompare((configs[a.id] || {}).startDate || ""));
    h += ordered.map(c => {
      const cfg = configs[c.id];
      const ph = phaseOf(cfg);
      const r = rec(c.id, today), d = r.day;
      const lw = lastWeight(c.id);
      const f = flagsFor(c.id);
      let status = `<div class="muted small" style="margin-top:6px">Plan not set up yet. Open to set it up.</div>`, sheet = "";
      if (cfg && cfg.meals) {
        const ex = exDone(cfg, today, r);
        const chip = (label, done) => `<span class="chip ${done ? "done" : ""}">${label}</span>`;
        status = `<div class="tasks">${cfg.meals.length ? chip("Meals " + (d.meals || []).filter(Boolean).length + "/" + cfg.meals.length, (d.meals || []).filter(Boolean).length === cfg.meals.length) : chip("Food " + (d.foods || []).reduce((a, x) => a + (+x.cal || 0), 0) + " cal", (d.foods || []).length > 0)}
          ${chip("Weigh-in" + (d.weight ? " " + d.weight : ""), !!d.weight)}${chip("Water " + (d.water || 0), (d.water || 0) >= ((cfg.targets || {}).water || 120))}
          ${chip("Steps" + (d.steps ? " " + d.steps : ""), !!d.steps)}${chip("Sleep" + (d.sleepHrs ? " " + d.sleepHrs + "h" : ""), !!d.sleepHrs)}${chip("Check-in", !!scoreOf(d))}${ex.wk && ex.wk !== "Rest" ? chip(ex.wk + " " + ex.done + "/" + ex.total, ex.total > 0 && ex.done === ex.total) : ""}</div>`;
        sheet = sheetHtml(c.id);
      }
      return `<div class="card" style="margin-top:12px"><h3 style="color:var(--ink)">${esc(c.name || "Client")}</h3>${ph ? `<div class="phase ${ph.cls}">${esc(ph.label)}${ph.cls === "focus" ? " &middot; needs the most attention" : ""}</div>` : ""}
        <div class="btns" style="margin:8px 0 10px"><a class="btn ghost" style="text-decoration:none;display:inline-flex;align-items:center" href="?preview=${encodeURIComponent(c.id)}">See app</a><button class="btn" data-c="open" data-id="${esc(c.id)}">Open</button></div>
        <div class="muted small">${lw ? "Last weigh-in " + esc(lw.w) + " lbs (" + short(lw.k) + ")" : "No weigh-ins yet"}</div>${status}
        ${f.map(x => `<span class="flag">${esc(x)}</span>`).join("")}${sheet}</div>`;
    }).join("");
    h += `<h2>Your own plan</h2><div class="card"><div class="muted small">Edit your own targets, exercises and schedule here.</div><div class="btns"><button class="btn ghost" data-c="myplan">Edit my plan</button></div></div>`;
    h += `<h2>Your data</h2><div class="card"><div class="muted small">Supabase's free plan has no automatic backups. Download a copy of everything every week or two and keep it somewhere safe.</div>
      <div class="btns"><button class="btn" data-c="backup">Download backup (all clients)</button></div></div>`;
    return h;
  }

  function threadHtml(id) {
    const list = msgs[id] || [];
    const fmt = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `<div class="thread">${list.length ? list.map(m => `<div class="bub ${m.sender === "coach" ? "client" : "coach"}">${esc(m.body)}<div class="bt">${m.sender === "coach" ? "You" : "Client"} &middot; ${esc(fmt(m.created_at))}</div></div>`).join("") : `<div class="muted small">No messages yet.</div>`}</div>`;
  }

  function viewClient() {
    const c = person(selected), isMe = selected === ctx.userId;
    const cfg = configs[selected];
    let h = topbar(isMe ? "My plan" : (c.name || "Client"), isMe ? "Your own app" : "Client", true) + (notice ? `<div class="card note" style="margin-top:12px">${esc(notice)}</div>` : "");

    if (!cfg || !cfg.meals) {
      return h + `<div class="card" style="margin-top:16px"><h3>Set up this client's plan</h3>
        <div class="muted small" style="margin-bottom:10px">Starts them on a blank template. You can change every number after.</div>
        <button class="btn" data-c="template">Set up from template</button></div>`;
    }

    const A = "text-decoration:none;display:inline-flex;align-items:center";
    if (!isMe) h += `<div class="btns"><a class="btn" style="${A}" href="?preview=${encodeURIComponent(selected)}">See ${esc(c.name || "client")}'s app</a><a class="btn ghost" style="${A}" href="?results=${encodeURIComponent(selected)}">Results page</a></div>`;
    if (!isMe) h += sheetHtml(selected, true);
    h += `<div class="btns"><button class="btn ghost" data-c="exportcsv">Download ${isMe ? "my" : esc(c.name || "client") + "'s"} data (CSV)</button></div>`;
    h += weightChartCard(selected);

    // messages
    if (!isMe) h += `<h2>Messages</h2><div class="card">${threadHtml(selected)}<div class="chips" style="margin-top:12px">${REPLY_TEMPLATES.map((t, i) => `<button class="chipbtn" data-c="tpl" data-i="${i}">${esc(t[0])}</button>`).join("")}</div><label class="field" for="reply-box" style="margin-top:8px">Reply</label><textarea id="reply-box" placeholder="Write to ${esc(c.name || "your client")}. They see it in the app."></textarea>
      <div class="btns"><button class="btn" data-c="reply">Send</button></div></div>`;

    // weekly report
    const wk = weekly(selected);
    h += `<h2>Weekly report</h2><div class="card"><div class="muted small" style="margin-bottom:8px">Last 7 days (through yesterday)</div>
      <div class="grid2">${wk.stats.map(s => `<div class="rowline small" style="border-bottom:1px solid var(--line);padding:4px 0"><span class="muted">${esc(s[0])}</span><strong>${esc(s[1])}</strong></div>`).join("")}</div>
      <div style="margin-top:10px"><b>Wins:</b> ${esc(wk.wins)}</div><div style="margin-top:6px"><b>Focus:</b> ${esc(wk.focus)}</div>
      <div class="btns"><button class="btn" data-c="usereview">Use as this week's review</button><button class="btn ghost" data-c="copyreport">Copy report</button></div></div>`;

    // macros
    const T = cfg.targets || {}, lw = lastWeight(selected);
    const cut = (cfg.goalWeight || 0) < (cfg.startWeight || 0);
    h += `<h2>Update macros from weigh-in</h2><div class="card"><div class="muted small" style="margin-bottom:8px">Protein is 0.8 g per lb, fat ceiling is 0.3 g per lb, carbs fill the rest.</div>
      <div class="grid2"><div><label class="field" for="mu-w">Current weight (lbs)</label><input id="mu-w" type="number" step="0.1" value="${lw ? lw.w : cfg.startWeight || ""}"></div>
      <div><label class="field" for="mu-cal">New calories</label><input id="mu-cal" type="number" value="${(T.calories || 0) + (cut ? -100 : 100)}"></div>
      <div><label class="field" for="mu-f">Fat (g) from the meals</label><input id="mu-f" type="number" value="${T.fat || 0}"></div></div>
      <div id="mu-out" style="margin-top:10px"></div><div class="btns"><button class="btn" data-c="applymacros">Apply to targets</button></div></div>`;

    // recent days
    const ks = Object.keys(logs[selected] || {}).sort().reverse().slice(0, 14);
    const rows = ks.map(k => {
      const r = logs[selected][k], d = r.day, s = scoreOf(d) || {};
      const ex = exDone(cfg, k, r);
      const low = v => (v && v <= 2 ? "low" : "");
      const notes = [(d.offPlan && d.offPlan.on) ? "Off plan: " + (d.offPlan.note || "") : "", d.msg ? "Message: " + d.msg : ""].filter(Boolean).join(" | ");
      return `<tr><td>${short(k)}</td><td>${d.weight || "-"}</td><td>${d.water || 0}</td><td>${d.steps || "-"}</td>
        <td class="${low(s.n)}">${s.n || "-"}</td><td>${s.i || "-"}</td><td class="${low(s.s)}">${s.s || "-"}</td><td class="${d.sleepHrs && d.sleepHrs < 6 ? "low" : ""}">${d.sleepHrs || "-"}</td><td>${s.h || "-"}/${s.e || "-"}</td>
        <td>${(cfg.meals || []).length ? (d.meals || []).filter(Boolean).length + "/" + cfg.meals.length : (d.foods || []).reduce((a, x) => a + (+x.cal || 0), 0) + " cal"}</td><td>${esc(ex.wk || "")}${ex.total ? " " + ex.done + "/" + ex.total : ""}</td><td>${esc(notes)}</td></tr>`;
    }).join("");
    h += `<h2>Last 14 days</h2><div class="card"><div class="tablewrap"><table class="log"><thead><tr><th>Date</th><th>Wt</th><th>Water</th><th>Steps</th><th>Nut</th><th>Int</th><th>Slp</th><th>Hrs</th><th>Hun/En</th><th>Meals</th><th>Workout</th><th>Notes</th></tr></thead><tbody>${rows || `<tr><td colspan="11" class="muted">No logs yet.</td></tr>`}</tbody></table></div></div>`;

    // lifts
    const liftDays = Object.keys(logs[selected] || {}).filter(k => Object.keys(logs[selected][k].lifts).length).sort().reverse().slice(0, 5);
    h += `<h2>Recent lifts</h2>` + (liftDays.map(k => {
      const r = logs[selected][k];
      const lines = Object.keys(r.lifts).filter(ex => (r.lifts[ex] || []).some(s => s && s.r)).map(ex =>
        `<div class="rowline small" style="margin-top:5px"><span>${esc(ex)}</span><span>${r.lifts[ex].filter(s => s && s.r).map(s => esc((s.w || "?") + " x " + s.r)).join(", ")}</span></div>`).join("");
      return `<div class="card"><h3>${short(k)} - ${esc(sessionName(cfg, k, r.day))}</h3>${lines}</div>`;
    }).join("") || `<div class="card muted">No lifts logged yet.</div>`);

    // progress photos
    const photoDays = Object.keys(logs[selected] || {}).filter(k => (logs[selected][k].day.photos || []).length).sort().reverse().slice(0, 8);
    h += `<h2>Progress photos</h2>` + (photoDays.map(k => `<div class="card"><h3 style="color:var(--ink)">${short(k)}</h3><div class="photogrid">${logs[selected][k].day.photos.map(p =>
      `<div class="ph"><a target="_blank" rel="noopener"><img data-ph="${esc(p.p)}" alt="${esc(p.a)} photo, ${k}"></a><div class="phl"><span>${esc(p.a)}</span></div></div>`).join("")}</div></div>`).join("") || `<div class="card muted">No photos yet.</div>`);

    // plan editor
    const rv = cfg.weeklyReview || {};
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
        <div class="grid2" style="margin-top:8px">${num(`ed-m${i}-p`, "Protein", m.p)}${num(`ed-m${i}-f`, "Fat", m.f)}${num(`ed-m${i}-c`, "Carbs", m.c)}${num(`ed-m${i}-cal`, "Calories", m.cal)}</div>
        <label class="field" for="ed-m${i}-swaps" style="margin-top:8px">Swaps, one per line: Name :: item; item :: protein/fat/carbs/calories</label>
        <textarea id="ed-m${i}-swaps" placeholder="Chicken rice bowl :: 150g chicken; 200g rice :: 40/4/60/430">${esc(swapsToText(m))}</textarea></div>`).join("")}
      <h3 style="margin-top:18px">Weekly schedule</h3>
      <div class="grid2">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((dn, i) => `<div><label class="field" for="ed-sch${i}">${dn}</label>
        <select id="ed-sch${i}">${Object.keys(cfg.workouts || {}).concat("Rest").map(o => `<option ${((cfg.schedule || [])[i] === o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`).join("")}</div>
      <h3 style="margin-top:18px">Exercises (one per line)</h3>
      ${Object.keys(cfg.workouts || {}).map((name, i) => `<label class="field" for="ed-wk${i}" style="margin-top:8px">${esc(name)}</label><textarea id="ed-wk${i}">${esc((cfg.workouts[name] || []).join("\n"))}</textarea>`).join("")}
      <label class="toggle" style="margin-top:16px"><input type="checkbox" id="ed-consent" ${cfg.resultsConsent ? "checked" : ""}> Client agreed to share their results</label>
      <div class="btns"><button class="btn" data-c="save">Save changes</button></div></div>`;
    return h;
  }

  const urls = {};
  async function hydratePhotos() {
    const imgs = [...document.querySelectorAll("img[data-ph]")];
    const need = [...new Set(imgs.map(i => i.dataset.ph).filter(p => !urls[p]))];
    if (need.length) {
      const { data } = await sb.storage.from("progress-photos").createSignedUrls(need, 3600);
      (data || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
    }
    imgs.forEach(i => { const u = urls[i.dataset.ph]; if (u) { i.src = u; const a = i.closest("a"); if (a) a.href = u; } });
  }

  function render(keepScroll) {
    const y = window.scrollY;
    view.innerHTML = selected ? viewClient() : viewList();
    window.scrollTo(0, keepScroll ? y : 0);
    hydratePhotos().catch(() => {});
    if (selected && document.getElementById("mu-w")) macroPreview(selected);
  }

  async function upsertConfig(id, cfg) {
    const { error } = await sb.from("client_config").upsert({ user_id: id, config: cfg, updated_at: new Date().toISOString() });
    if (error) { notice = "Could not save: " + error.message; return false; }
    configs[id] = cfg; return true;
  }

  async function openClient(id) {
    selected = id; notice = ""; render();
    const { data } = await sb.from("messages").select("id,client_id,sender,body,created_at,read").eq("client_id", id).order("created_at", { ascending: true });
    if (data) { msgs[id] = data; }
    const ids = (msgs[id] || []).filter(m => m.sender === "client" && !m.read).map(m => m.id);
    if (ids.length) { await sb.from("messages").update({ read: true }).in("id", ids); (msgs[id] || []).forEach(m => { if (ids.includes(m.id)) m.read = true; }); }
    if (selected === id) render(true);
  }

  const val = id => document.getElementById(id).value;
  const n = id => parseFloat(val(id)) || 0;
  const copy = async t => { try { await navigator.clipboard.writeText(t); notice = "Copied."; } catch (e) { notice = "Could not copy. Select the text and copy it."; } render(true); };

  view.addEventListener("input", e => { if (e.target.id && e.target.id.startsWith("mu-") && selected) macroPreview(selected); });

  view.addEventListener("click", async e => {
    const t = e.target.closest("[data-c]");
    if (!t) return;
    const a = t.dataset.c;
    if (a === "logout") { ctx.logout(); return; }
    if (a === "myapp") { ctx.switchToMe(); return; }
    if (a === "backup") { backupAll(); return; }
    if (a === "myplan") { selected = ctx.userId; notice = ""; render(); return; }
    if (a === "tpl") { const b = document.getElementById("reply-box"); if (b) { b.value = REPLY_TEMPLATES[+t.dataset.i][1]; b.focus(); } return; }
    if (a === "exportcsv") { exportCsv(selected); return; }
    if (a === "back") { selected = null; notice = ""; render(); return; }
    if (a === "open") { openClient(t.dataset.id); return; }
    if (a === "copysheet") {
      const b = brief(t.dataset.id), c = clients.find(x => x.id === t.dataset.id);
      copy(`${(c && c.name) || "Client"} - call brief (${short(yesterday)})\n` + b.rows.map(r => `${r.st === "ok" ? "+" : r.st === "na" ? "-" : "!"} ${r.label}: ${r.val}`).join("\n")
        + (b.bad.length ? "\n\nFell short:\n- " + b.bad.join("\n- ") : "") + (b.well.length ? "\n\nWent well:\n- " + b.well.join("\n- ") : "")
        + "\n\nTalk about:\n" + b.talk.map((x, i) => (i + 1) + ". " + x).join("\n") + "\n\nToday: " + b.today + "\nLast 7 days: " + b.trend); return;
    }
    if (a === "savenote") {
      const ok = await saveNote(t.dataset.id, document.getElementById("call-note").value.trim());
      notice = ok ? "Call notes saved." : notice; render(true); return;
    }
    if (a === "copyreport") { copy(weekly(selected).text); return; }
    if (a === "usereview") {
      const wk = weekly(selected);
      document.getElementById("ed-title").value = wk.title; document.getElementById("ed-wins").value = wk.wins; document.getElementById("ed-focus").value = wk.focus;
      document.getElementById("ed-title").scrollIntoView({ behavior: "smooth", block: "center" });
      notice = "Review drafted in Edit plan below. Change anything, then Save changes.";
      const nb = view.querySelector(".card.note"); if (nb) nb.textContent = notice; else view.insertAdjacentHTML("afterbegin", `<div class="card note">${esc(notice)}</div>`);
      return;
    }
    if (a === "reply") {
      const body = val("reply-box").trim(); if (!body) return;
      const { data, error } = await sb.from("messages").insert({ client_id: selected, sender: "coach", body }).select("id,client_id,sender,body,created_at,read").single();
      if (error) notice = "Could not send: " + error.message; else { (msgs[selected] = msgs[selected] || []).push(data); notice = "Sent. They'll see it in the app."; }
      render(true); return;
    }
    if (a === "applymacros") {
      const cfg = JSON.parse(JSON.stringify(configs[selected]));
      const w = parseFloat(val("mu-w")), cal = parseFloat(val("mu-cal")), f = parseFloat(val("mu-f")) || 0;
      if (!w || !cal) { notice = "Enter a weight and calories first."; render(true); return; }
      const m = macroCalc(w, cal, f);
      cfg.targets = Object.assign({}, cfg.targets, { calories: m.cal, protein: m.p, carbs: m.c, fat: m.f, fatCeiling: m.fc });
      cfg.macroLog = (cfg.macroLog || []).concat({ date: today, weight: w, calories: m.cal, protein: m.p, fat: m.f, carbs: m.c });
      notice = (await upsertConfig(selected, cfg)) ? `Targets updated: ${m.cal} cal, P ${m.p} / F ${m.f} / C ${m.c}. Adjust the meals below if they don't add up.` : notice;
      render(true); return;
    }
    if (a === "template") {
      const c = person(selected);
      const cfg = JSON.parse(JSON.stringify(CLIENT)); cfg.name = c.name || cfg.name; cfg.startDate = today;
      notice = (await upsertConfig(selected, cfg)) ? "Plan created. Change anything below." : notice; render(); return;
    }
    if (a === "save") {
      const c = person(selected);
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
      cfg.resultsConsent = document.getElementById("ed-consent").checked;
      cfg.meals = cfg.meals.map((m, i) => Object.assign({}, m, { items: val(`ed-m${i}-items`).split("\n").map(x => x.trim()).filter(Boolean), p: n(`ed-m${i}-p`), f: n(`ed-m${i}-f`), c: n(`ed-m${i}-c`), cal: n(`ed-m${i}-cal`), swaps: textToSwaps(val(`ed-m${i}-swaps`)) }));
      const ok = await upsertConfig(selected, cfg);
      if (ok && nm !== c.name) { const r = await sb.from("profiles").update({ name: nm }).eq("id", selected); if (!r.error) c.name = nm; }
      notice = ok ? "Saved. The client sees it next time they open the app." : notice; render();
    }
  });

  view.innerHTML = `<div class="muted">Loading...</div>`;
  loadAll().then(() => render());
};

/* ---------- results page (coach only): ?results=<client id> ---------- */
window.startResults = async function (ctx, id) {
  const sb = ctx.sb, view = document.getElementById("view");
  document.getElementById("app").style.maxWidth = "820px";
  document.body.classList.add("results");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const toDate = k => new Date(k + "T12:00:00");
  const short = k => toDate(k).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const today = iso(new Date());
  view.innerHTML = `<div class="muted">Loading...</div>`;
  const [who, cfgR, logR] = await Promise.all([
    sb.from("profiles").select("name").eq("id", id).maybeSingle(),
    sb.from("client_config").select("config").eq("user_id", id).maybeSingle(),
    sb.from("day_logs").select("log_date,day,lifts").eq("user_id", id).order("log_date", { ascending: true })
  ]);
  const cfg = (cfgR.data && cfgR.data.config) || {}, rows = logR.data || [];
  const name = cfg.name || (who.data && who.data.name) || "Client";
  const days = {}; rows.forEach(r => { days[r.log_date] = r; });

  const wm = {}; (cfg.weightLog || []).forEach(x => { wm[x.date] = x.w; }); rows.forEach(r => { if (r.day && r.day.weight) wm[r.log_date] = r.day.weight; });
  const ws = Object.keys(wm).sort().map(k => ({ date: k, w: wm[k] }));
  const startW = ws.length ? ws[0].w : cfg.startWeight, nowW = ws.length ? ws[ws.length - 1].w : cfg.startWeight;
  const change = Math.round((nowW - startW) * 10) / 10;

  const photoDays = rows.filter(r => ((r.day || {}).photos || []).length).map(r => r.log_date);
  const pick = k => { const ph = days[k].day.photos; return ph.find(p => p.a === "front") || ph[0]; };
  const firstP = photoDays.length ? pick(photoDays[0]) : null, lastP = photoDays.length > 1 ? pick(photoDays[photoDays.length - 1]) : null;
  let urlMap = {};
  const need = [firstP, lastP].filter(Boolean).map(p => p.p);
  if (need.length) { const { data } = await sb.storage.from("progress-photos").createSignedUrls(need, 3600); (data || []).forEach(x => { urlMap[x.path] = x.signedUrl; }); }

  const exs = Object.keys(cfg.workouts || {}).flatMap(k => cfg.workouts[k]);
  const topW = (r, ex) => Math.max(0, ...(((r.lifts || {})[ex] || []).filter(s => s && s.r).map(s => parseFloat(s.w) || 0)));
  const gains = exs.map(ex => {
    const ser = rows.map(r => ({ k: r.log_date, w: topW(r, ex) })).filter(x => x.w > 0);
    return ser.length > 1 ? { ex, from: ser[0].w, to: Math.max(...ser.map(x => x.w)), n: ser.length } : null;
  }).filter(Boolean).map(g => Object.assign(g, { gain: g.to - g.from })).sort((a, b) => b.gain - a.gain).slice(0, 6);

  const start = cfg.startDate || (rows[0] && rows[0].log_date) || today;
  const span = Math.max(1, Math.round((toDate(today) - toDate(start)) / 864e5) + 1);
  const ciDays = rows.filter(r => { const c = (r.day || {}).checkin || {}; return c.n && c.i && c.s; });
  let best = 0, cur = 0; for (let i = 0; i < span; i++) { const d = toDate(start); d.setDate(d.getDate() + i); const r = days[iso(d)]; const c = r && (r.day || {}).checkin; if (c && c.n && c.i && c.s) { cur++; best = Math.max(best, cur); } else cur = 0; }
  const lifted = rows.filter(r => Object.keys(r.lifts || {}).length).length;

  const stat = (n, l) => `<div class="macro"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const photo = (p, label) => `<div class="ph"><img src="${esc(urlMap[p.p] || "")}" alt="${esc(label)}"><div class="phl"><span>${esc(label)}</span></div></div>`;
  view.innerHTML = `<div class="btns noprint"><button class="btn ghost" id="rs-back">Back</button><button class="btn" id="rs-print">Print or save as PDF</button></div>
    ${cfg.resultsConsent ? "" : `<div class="card note noprint"><b>Not cleared to share.</b> Tick "Client agreed to share their results" on their page before you send this to anyone.</div>`}
    <div class="eyebrow" style="margin-top:12px">Awwab Fitness</div><h1>${esc(name)}: ${cfg.totalWeeks || 12}-week results</h1>
    <div class="muted">${esc(short(start))} to ${esc(short(today))}</div>
    <div class="macros four" style="margin-top:16px">${stat(startW, "Start (lbs)")}${stat(nowW, "Now (lbs)")}${stat((change > 0 ? "+" : "") + change, "Change (lbs)")}${stat(lifted, "Training days")}</div>
    ${firstP ? `<h2>Before and after</h2><div class="photogrid" style="grid-template-columns:repeat(2,1fr)">${photo(firstP, "Start, " + short(photoDays[0]))}${lastP ? photo(lastP, "Latest, " + short(photoDays[photoDays.length - 1])) : `<div class="card muted">Latest photos coming soon.</div>`}</div>` : ""}
    ${gains.length ? `<h2>Strength</h2><div class="card">${gains.map(g => `<div class="rowline" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(g.ex)}</span><strong>${g.from} to ${g.to} lbs${g.gain > 0 ? " (+" + g.gain + ")" : ""}</strong></div>`).join("")}</div>` : ""}
    <h2>Consistency</h2><div class="macros" style="grid-template-columns:repeat(3,1fr)">${stat(ciDays.length + "/" + span, "Check-ins")}${stat(best, "Longest streak")}${stat(Math.round(ciDays.length / span * 100) + "%", "Days checked in")}</div>
    <div class="muted small" style="margin-top:16px">Built in the Awwab Fitness app.</div>`;
  document.getElementById("rs-back").onclick = () => { location.href = location.pathname; };
  document.getElementById("rs-print").onclick = () => window.print();
};
