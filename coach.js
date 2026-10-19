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

  let clients = [], configs = {}, logs = {}, msgs = {}, selected = null, notice = "";

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
    configs = {}; (c.data || []).forEach(r => { configs[r.user_id] = r.config || {}; });
    logs = {}; (l.data || []).forEach(r => { (logs[r.user_id] = logs[r.user_id] || {})[r.log_date] = { day: r.day || {}, lifts: r.lifts || {} }; });
    msgs = {}; ((m && m.data) || []).forEach(x => { (msgs[x.client_id] = msgs[x.client_id] || []).push(x); });
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

  /* ---------- weekly report ---------- */
  function weekly(id) {
    const cfg = configs[id] || {};
    const days = dateList(yesterday, 7);
    const N = [], I = [], Sl = [], steps = [], water = [];
    let ci = 0, mealSum = 0, mealDen = 0, wkSched = 0, wkDone = 0, off = 0;
    days.forEach(k => {
      const r = rec(id, k), d = r.day, s = scoreOf(d);
      if (s) { ci++; N.push(s.n); I.push(s.i); Sl.push(s.s); }
      if (d.steps) steps.push(d.steps);
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
      ["Steps (avg)", steps.length ? Math.round(avg(steps)).toLocaleString() : "-"], ["Water (avg)", water.length ? Math.round(avg(water)) + " oz" : "-"],
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
      <div class="btns" style="margin:0">${back ? `<button class="btn ghost" data-c="back">Back</button>` : ""}<button class="btn ghost" data-c="logout">Log out</button></div></div>`;
  }

  function sheetHtml(id) {
    const cs = callSheet(id);
    return `<div class="sheet"><div class="eyebrow" style="margin-bottom:4px">For your call</div>
      ${cs.lines.map(l => `<div class="small">${esc(l)}</div>`).join("")}
      ${cs.q.length ? `<ol class="qs">${cs.q.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : `<div class="muted small" style="margin-top:6px">Nothing flagged. Ask how they're feeling.</div>`}
      <div class="btns" style="margin-top:6px"><button class="btn ghost" data-c="copysheet" data-id="${esc(id)}">Copy call notes</button></div></div>`;
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
      let status = `<div class="muted small" style="margin-top:6px">Plan not set up yet. Open to set it up.</div>`, sheet = "";
      if (cfg && cfg.meals) {
        const ex = exDone(cfg, today, r);
        const chip = (label, done) => `<span class="chip ${done ? "done" : ""}">${label}</span>`;
        status = `<div class="tasks">${cfg.meals.length ? chip("Meals " + (d.meals || []).filter(Boolean).length + "/" + cfg.meals.length, (d.meals || []).filter(Boolean).length === cfg.meals.length) : chip("Food " + (d.foods || []).reduce((a, x) => a + (+x.cal || 0), 0) + " cal", (d.foods || []).length > 0)}
          ${chip("Weigh-in" + (d.weight ? " " + d.weight : ""), !!d.weight)}${chip("Water " + (d.water || 0), (d.water || 0) >= ((cfg.targets || {}).water || 120))}
          ${chip("Steps" + (d.steps ? " " + d.steps : ""), !!d.steps)}${chip("Check-in", !!scoreOf(d))}${ex.wk && ex.wk !== "Rest" ? chip(ex.wk + " " + ex.done + "/" + ex.total, ex.total > 0 && ex.done === ex.total) : ""}</div>`;
        sheet = sheetHtml(c.id);
      }
      return `<div class="card" style="margin-top:12px"><h3 style="color:var(--ink)">${esc(c.name || "Client")}</h3>
        <div class="btns" style="margin:8px 0 10px"><a class="btn ghost" style="text-decoration:none;display:inline-flex;align-items:center" href="?preview=${encodeURIComponent(c.id)}">See app</a><button class="btn" data-c="open" data-id="${esc(c.id)}">Open</button></div>
        <div class="muted small">${lw ? "Last weigh-in " + esc(lw.w) + " lbs (" + short(lw.k) + ")" : "No weigh-ins yet"}</div>${status}
        ${f.map(x => `<span class="flag">${esc(x)}</span>`).join("")}${sheet}</div>`;
    }).join("");
    return h;
  }

  function threadHtml(id) {
    const list = msgs[id] || [];
    const fmt = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `<div class="thread">${list.length ? list.map(m => `<div class="bub ${m.sender === "coach" ? "client" : "coach"}">${esc(m.body)}<div class="bt">${m.sender === "coach" ? "You" : "Client"} &middot; ${esc(fmt(m.created_at))}</div></div>`).join("") : `<div class="muted small">No messages yet.</div>`}</div>`;
  }

  function viewClient() {
    const c = clients.find(x => x.id === selected);
    const cfg = configs[selected];
    let h = topbar(c.name || "Client", "Client", true) + (notice ? `<div class="card note" style="margin-top:12px">${esc(notice)}</div>` : "");

    if (!cfg || !cfg.meals) {
      return h + `<div class="card" style="margin-top:16px"><h3>Set up this client's plan</h3>
        <div class="muted small" style="margin-bottom:10px">Starts them on a blank template. You can change every number after.</div>
        <button class="btn" data-c="template">Set up from template</button></div>`;
    }

    const A = "text-decoration:none;display:inline-flex;align-items:center";
    h += `<div class="btns"><a class="btn" style="${A}" href="?preview=${encodeURIComponent(selected)}">See ${esc(c.name || "client")}'s app</a><a class="btn ghost" style="${A}" href="?results=${encodeURIComponent(selected)}">Results page</a></div>`;
    h += sheetHtml(selected);

    // messages
    h += `<h2>Messages</h2><div class="card">${threadHtml(selected)}<label class="field" for="reply-box" style="margin-top:12px">Reply</label><textarea id="reply-box" placeholder="Write to ${esc(c.name || "your client")}. They see it in the app."></textarea>
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
        <td class="${low(s.n)}">${s.n || "-"}</td><td>${s.i || "-"}</td><td class="${low(s.s)}">${s.s || "-"}</td><td>${s.h || "-"}/${s.e || "-"}</td>
        <td>${(cfg.meals || []).length ? (d.meals || []).filter(Boolean).length + "/" + cfg.meals.length : (d.foods || []).reduce((a, x) => a + (+x.cal || 0), 0) + " cal"}</td><td>${esc(ex.wk || "")}${ex.total ? " " + ex.done + "/" + ex.total : ""}</td><td>${esc(notes)}</td></tr>`;
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
    if (a === "back") { selected = null; notice = ""; render(); return; }
    if (a === "open") { openClient(t.dataset.id); return; }
    if (a === "copysheet") {
      const cs = callSheet(t.dataset.id), c = clients.find(x => x.id === t.dataset.id);
      copy(`${(c && c.name) || "Client"} - call notes\n` + cs.lines.join("\n") + "\n\nAsk:\n" + cs.q.map((x, i) => (i + 1) + ". " + x).join("\n")); return;
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
