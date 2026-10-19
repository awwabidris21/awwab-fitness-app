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
  const save = k => { if (ctx.readOnly) return; dirty.add(k || date); setStatus("Saving..."); clearTimeout(timer); timer = setTimeout(flush, 600); };

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const toDate = k => new Date(k + "T12:00:00");
  const realToday = iso(new Date());
  let date = realToday;
  let tab = "home";

  const dayRec = k => { if (!S.days[k]) S.days[k] = { meals: [], water: 0 }; return S.days[k]; };
  const scheduled = k => C.schedule[toDate(k).getDay()];
  const workoutFor = k => (S.days[k] && S.days[k].workout) || scheduled(k);
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

  function tasks(k) {
    const d = peek(k);
    const t = [
      { label: "Meals", done: C.meals.every((_, i) => d.meals[i]) },
      { label: "Weigh-in", done: !!d.weight },
      { label: "Water", done: (d.water || 0) >= C.targets.water },
      { label: "Steps", done: !!d.steps },
      { label: "Check-in", done: checkinDone(d) }
    ];
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
    return h + days.map(k => `<div class="card"><h3 style="color:var(--ink)">${k === realToday ? "Today" : toDate(k).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</h3>
      <div class="photogrid">${S.days[k].photos.map(p => `<div class="ph"><a target="_blank" rel="noopener"><img data-ph="${esc(p.p)}" alt="${esc(p.a)} photo, ${k}"></a>
        <div class="phl"><span>${esc(p.a)}</span>${ctx.readOnly ? "" : `<button class="x" data-act="delphoto" data-d="${k}" data-p="${esc(p.p)}" aria-label="Delete photo">&times;</button>`}</div></div>`).join("")}</div></div>`).join("");
  }

  function header(title, sub, back) {
    const isToday = date === realToday;
    if (back) return `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div><button class="btn ghost" data-go="home">Back</button></div>`;
    if (!DAY_TABS.includes(tab)) return `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div></div>`;
    return `<div class="topbar"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div>
      <div class="datenav"><button data-act="prev" aria-label="Previous day">&lsaquo;</button><button data-act="next" aria-label="Next day" ${isToday ? "disabled" : ""}>&rsaquo;</button></div></div>`;
  }

  const consumed = d => C.meals.reduce((a, m, i) => d.meals[i] ? { p: a.p + m.p, f: a.f + m.f, c: a.c + m.c, cal: a.cal + m.cal } : a, { p: 0, f: 0, c: 0, cal: 0 });
  const pctOf = (v, t) => (t ? Math.max(0, Math.min(100, Math.round(v / t * 100))) : 0);

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

    h += `<div class="duo" style="margin-top:16px">
      ${F.streaks ? `<button class="card streakcard" data-go="streaks" aria-label="See your streaks"><div class="flame">${flame}</div><div class="big">${streak()}</div><div class="muted small">day streak</div><div class="muted small">Best ${bestStreak()}</div></button>` : ""}
      <div class="card ringcard">${ring(Math.round(nDone / t.length * 100), nDone + "/" + t.length, "Today")}<div class="muted small">done today</div></div>
    </div>`;

    if (F.goalBar) {
      const lost = C.startWeight - latestWeight();
      const gp = pctOf(lost, C.startWeight - C.goalWeight);
      h += `<button class="card" data-go="progress" style="width:100%;text-align:left;font:inherit;color:inherit">
        <div class="rowline"><span class="eyebrow" style="margin:0">Week ${weekNum()} of ${C.totalWeeks}</span><span class="muted small">${latestWeight()} lbs now</span></div>
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
      ${tile("nutrition", "Protein", done.p + "g", "of " + T.protein + "g", pctOf(done.p, T.protein))}
      ${tile("nutrition", "Water", w + " oz", "of " + T.water + " oz", pctOf(w, T.water))}
    </div>`;

    if (C.coachNote) h += `<div class="card note" style="margin-top:16px"><div class="eyebrow">Note from your coach</div>${esc(C.coachNote)}</div>`;

    h += `<h2>Log your day</h2><div class="card"><div class="grid2">
      <div><label class="field" for="weight">Weigh-in (lbs)</label><input id="weight" type="number" inputmode="decimal" step="0.1" data-f="weight" value="${d.weight || ""}" placeholder="morning"></div>
      <div><label class="field" for="steps">Steps</label><input id="steps" type="number" inputmode="numeric" data-f="steps" value="${d.steps || ""}" placeholder="${T.steps.toLocaleString()}"></div></div></div>`;

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

  /* ---------- TRAINING ---------- */
  function lastSession(ex) {
    const dates = Object.keys(S.lifts).filter(k => k < date && loggedSets(k, ex).length).sort();
    if (!dates.length) return "";
    const k = dates[dates.length - 1];
    return "Last time: " + loggedSets(k, ex).map(s => `${s.w || "?"} &times; ${s.r}`).join(", ");
  }

  function liftHistory() {
    let h = `<h2>Lift progress</h2>`;
    let any = false;
    Object.keys(C.workouts).forEach(name => {
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
    return h + (any ? "" : `<div class="card muted">Your logged lifts will show up here.</div>`);
  }

  function viewTraining() {
    const wk = workoutFor(date);
    let h = header(wk === "Rest" ? "Rest day" : wk, "Training - " + niceDate(date));
    h += `<div class="muted small" style="margin:14px 0 6px">What did you train? Change it if you did a different session than scheduled.</div>
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
        for (let s = 0; s < C.sets; s++) {
          const v = rec[s] || {};
          rows += `<div class="sn">${s + 1}</div>
            <input type="number" inputmode="decimal" placeholder="lbs" data-lift="${xi}" data-set="${s}" data-fld="w" value="${v.w || ""}" aria-label="${esc(ex)} set ${s + 1} weight">
            <input type="number" inputmode="numeric" placeholder="reps" data-lift="${xi}" data-set="${s}" data-fld="r" value="${v.r || ""}" aria-label="${esc(ex)} set ${s + 1} reps">`;
        }
        const last = lastSession(ex);
        return `<div class="card ex"><h3 style="color:var(--ink)">${esc(ex)}</h3><div class="sets">${rows}</div>${last ? `<div class="last">${last}</div>` : ""}</div>`;
      }).join("");
    }
    h += liftHistory();
    h += `<h2>Weekly schedule</h2><div class="card">` + [1, 2, 3, 4, 5, 6, 0].map(i =>
      `<div class="rowline" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}</span><strong>${esc(C.schedule[i])}</strong></div>`).join("") + `</div>`;
    return h;
  }

  /* ---------- NUTRITION ---------- */
  function viewNutrition() {
    const d = dayRec(date), done = consumed(d), T = C.targets, w = d.water || 0;
    let h = header("Nutrition", niceDate(date));
    const mac = (label, v, t, unit) => `<div class="macro"><div class="n">${v}${unit}</div><div class="l">${label}</div><div class="t">of ${t}${unit}</div><div class="bar" style="margin-top:6px"><i style="width:${pctOf(v, t)}%"></i></div></div>`;
    h += `<div class="card" style="margin-top:16px"><div class="rowline"><span class="big">${done.cal.toLocaleString()}</span><span class="muted">of ${T.calories.toLocaleString()} calories</span></div>
      <div class="bar ${done.cal >= T.calories ? "good" : ""}"><i style="width:${pctOf(done.cal, T.calories)}%"></i></div>
      <div class="muted small" style="margin-top:8px">Check off your meals on the Meals tab and these numbers fill in.</div></div>
      <div class="macros">${mac("Protein", done.p, T.protein, "g")}${mac("Carbs", done.c, T.carbs, "g")}${mac("Fat", done.f, T.fat, "g")}</div>`;
    h += `<h2>Water</h2><div class="card"><div class="rowline"><span class="big">${w}<span class="muted small"> / ${T.water} oz</span></span></div>
      <div class="bar ${w >= T.water ? "good" : ""}"><i style="width:${pctOf(w, T.water)}%"></i></div>
      <div class="btns"><button class="btn" data-act="water" data-v="8">+ 8 oz</button><button class="btn ghost" data-act="water" data-v="-8">- 8 oz</button></div></div>`;
    h += `<h2>How your numbers work</h2>` + (C.plan || []).filter(s => /nutrition|daily/i.test(s.h)).map(s => `<div class="card"><h3>${esc(s.h)}</h3><div>${esc(s.p)}</div></div>`).join("");
    h += `<div class="muted small">Fat target is about ${T.fat}g. The ceiling is ${T.fatCeiling}g, and it's fine to land under it.</div>`;
    return h;
  }

  /* ---------- MEALS ---------- */
  function viewMeals() {
    const d = dayRec(date);
    const n = (d.meals || []).filter(Boolean).length;
    let h = header("Meal plan", niceDate(date));
    h += `<div class="card" style="margin-top:16px"><div class="rowline"><span class="big">${n} of ${C.meals.length} meals</span></div><div class="bar ${n === C.meals.length ? "good" : ""}"><i style="width:${pctOf(n, C.meals.length)}%"></i></div>
      <div class="muted small" style="margin-top:8px">Tap a meal when you've eaten it.</div></div>`;
    h += C.meals.map((m, i) => `
      <div class="card meal ${d.meals[i] ? "done" : ""}" data-act="meal" data-i="${i}" role="checkbox" aria-checked="${!!d.meals[i]}" tabindex="0">
        <div class="check">${d.meals[i] ? "&#10003;" : ""}</div>
        <div style="flex:1"><h3 style="color:var(--ink)">${esc(m.name)}</h3><div class="muted small">${esc(m.note)}</div>
        <ul>${m.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="mrow"><span>P ${m.p}g</span><span>F ${m.f}g</span><span>C ${m.c}g</span><span>${m.cal} cal</span></div></div>
      </div>`).join("") + `<div class="muted small">${esc(C.mealNote)}</div>`;
    return h;
  }

  /* ---------- NOTES ---------- */
  function viewNotes() {
    const d = dayRec(date);
    let h = header("Notes", "From your coach");
    h += C.coachNote ? `<div class="card note" style="margin-top:16px"><div class="eyebrow">Note from your coach</div>${esc(C.coachNote)}</div>` : `<div class="card muted" style="margin-top:16px">No note from your coach today.</div>`;
    if (F.weeklyReview && C.weeklyReview) {
      const r = C.weeklyReview;
      h += `<h2>${esc(r.title)}</h2><div class="card"><h3>Wins</h3><div>${esc(r.wins)}</div><h3 style="margin-top:12px">Focus this week</h3><div>${esc(r.focus)}</div></div>`;
    }
    h += `<h2>Message your coach</h2><div class="card"><label class="field" for="msg">Anything I should know about today? (hunger, sore, travel, questions)</label>
      <textarea id="msg" data-f="msg" placeholder="Type here. Your coach sees it.">${esc(d.msg || "")}</textarea></div>`;
    h += `<h2>Plan notes</h2>` + (C.plan || []).map(s => `<div class="card"><h3>${esc(s.h)}</h3><div>${esc(s.p)}</div></div>`).join("");
    if (ctx.readOnly) return h + `<div class="btns" style="margin-top:20px"><button class="btn ghost" data-act="logout">Back to coach view</button></div>`;
    h += `<h2>Account</h2><div class="card"><h3>Change password</h3>
      <label class="field" for="pw1">New password (8 or more characters)</label><input id="pw1" type="password" autocomplete="new-password">
      <label class="field" for="pw2" style="margin-top:10px">Type it again</label><input id="pw2" type="password" autocomplete="new-password">
      ${pwMsg ? `<div class="${pwOk ? "muted" : "err"} small" style="margin-top:8px">${esc(pwMsg)}</div>` : ""}
      <div class="btns"><button class="btn" data-act="setpw">Update password</button></div></div>`;
    h += `<div class="btns" style="margin-top:20px"><button class="btn ghost" data-act="logout">Log out</button></div>`;
    return h;
  }

  /* ---------- PROGRESS (from Home) ---------- */
  function chart(points) {
    if (points.length < 2) return `<div class="muted">Log your weight a few days to see the chart.</div>`;
    const W = 340, H = 150, pad = 28;
    const ws = points.map(p => p.w);
    const lo = Math.floor(Math.min(...ws) - 1), hi = Math.ceil(Math.max(...ws) + 1);
    const t0 = toDate(points[0].date).getTime(), t1 = toDate(points[points.length - 1].date).getTime();
    const x = p => pad + (t1 === t0 ? 0 : (toDate(p.date).getTime() - t0) / (t1 - t0)) * (W - pad - 10);
    const y = p => 10 + (1 - (p.w - lo) / (hi - lo)) * (H - 30);
    const path = points.map((p, i) => (i ? "L" : "M") + x(p).toFixed(1) + " " + y(p).toFixed(1)).join(" ");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart over time">
      <line x1="${pad}" y1="${H - 20}" x2="${W - 10}" y2="${H - 20}" stroke="var(--line)"/>
      <text x="2" y="${y({ w: hi }) + 4}">${hi}</text><text x="2" y="${y({ w: lo }) + 4}">${lo}</text>
      <path d="${path}" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map(p => `<circle cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="3.5" fill="var(--amber)"/>`).join("")}
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
    h += `<h2>Weight</h2><div class="card">${chart(pts)}</div>`;
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

  /* ---------- render & events ---------- */
  function render() {
    const views = { home: viewHome, training: viewTraining, nutrition: viewNutrition, meals: viewMeals, notes: viewNotes, progress: viewProgress, streaks: viewStreaks };
    document.getElementById("view").innerHTML = views[tab]();
    const hl = tab === "progress" || tab === "streaks" ? "home" : tab;
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === hl));
    hydratePhotos().catch(() => {});
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab],[data-act],[data-go]");
    if (!t) return;
    if (t.dataset.tab || t.dataset.go) { tab = t.dataset.tab || t.dataset.go; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.act === "logout") { ctx.logout(); return; }
    if (ctx.readOnly && !["prev", "next", "ciopen", "ciclose"].includes(t.dataset.act)) return;
    if (t.dataset.act === "setpw") { changePassword(); return; }
    const d = dayRec(date);
    switch (t.dataset.act) {
      case "prev": { const x = toDate(date); x.setDate(x.getDate() - 1); date = iso(x); break; }
      case "next": { const x = toDate(date); x.setDate(x.getDate() + 1); if (iso(x) <= realToday) date = iso(x); break; }
      case "meal": d.meals[+t.dataset.i] = !d.meals[+t.dataset.i]; save(); break;
      case "water": d.water = Math.max(0, (d.water || 0) + (+t.dataset.v)); save(); break;
      case "rate": { d.checkin = d.checkin || {}; const k = t.dataset.k, v = +t.dataset.v; d.checkin[k] = d.checkin[k] === v ? null : v; save(); break; }
      case "wtype": d.workout = t.dataset.v; save(); break;
      case "delphoto": if (confirm("Delete this photo?")) deletePhoto(t.dataset.d, t.dataset.p); return;
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

  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches('[data-act="meal"]')) { e.preventDefault(); e.target.click(); }
  });

  document.addEventListener("change", e => {
    if (ctx.readOnly) return;
    const t = e.target;
    if (t.dataset.phAngle) { const f = t.files && t.files[0]; if (f) uploadPhoto(f, t.dataset.phAngle); t.value = ""; return; }
    const d = dayRec(date);
    if (t.dataset.f === "weight") { d.weight = parseFloat(t.value) || null; save(); render(); return; }
    if (t.dataset.f === "steps") { d.steps = parseInt(t.value, 10) || null; save(); render(); return; }
    if (t.dataset.f === "offnote") { d.offPlan = d.offPlan || {}; d.offPlan.note = t.value; save(); return; }
    if (t.dataset.f === "msg") { d.msg = t.value; save(); return; }
    if (t.dataset.lift !== undefined) {
      const ex = C.workouts[workoutFor(date)][+t.dataset.lift];
      S.lifts[date] = S.lifts[date] || {};
      const arr = S.lifts[date][ex] = S.lifts[date][ex] || [];
      const s = +t.dataset.set;
      arr[s] = arr[s] || {};
      arr[s][t.dataset.fld] = t.value;
      save();
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
  });

  render();
};
