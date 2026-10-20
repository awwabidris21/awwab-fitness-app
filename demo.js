/* Demo mode (?demo=1 for the client app, ?demo=coach for the coach dashboard).
   Fake people and fake data only, generated fresh relative to today. Nothing here touches the real database:
   the app is handed an in-memory stand-in for Supabase, so taps work but nothing is saved after a refresh. */
(function () {
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const PPL = ["Rest", "Push", "Pull", "Legs", "Push", "Pull", "Legs"];
  const UL = ["Rest", "Upper", "Lower", "Rest", "Upper", "Lower", "Rest"];
  const WORKOUTS_PPL = {
    Push: ["Incline Smith Press", "Cable Fly", "Shoulder Press Machine", "Lateral Raises", "Tricep Pushdowns"],
    Pull: ["Lat Pulldown", "Seated Row", "Face Pulls", "Preacher Curls", "Hammer Curls"],
    Legs: ["Squats", "RDLs", "Leg Extensions", "Leg Curls", "Calf Raises"]
  };
  const WORKOUTS_UL = {
    Upper: ["Chest Press Machine", "Lat Pulldown", "Shoulder Press Machine", "Seated Row", "Lateral Raises", "Tricep Pushdowns", "Dumbbell Curls"],
    Lower: ["Leg Press", "RDLs", "Leg Extensions", "Leg Curls", "Calf Raises", "Cable Crunches"]
  };
  const BASE = { "Incline Smith Press": 115, "Cable Fly": 30, "Shoulder Press Machine": 80, "Lateral Raises": 15, "Tricep Pushdowns": 50, "Lat Pulldown": 110, "Seated Row": 100, "Face Pulls": 40, "Preacher Curls": 50, "Hammer Curls": 25, "Squats": 165, "RDLs": 135, "Leg Extensions": 90, "Leg Curls": 80, "Calf Raises": 120, "Chest Press Machine": 90, "Dumbbell Curls": 25, "Leg Press": 250, "Cable Crunches": 70 };

  const MEALS = [
    { name: "Breakfast", note: "Slow-digesting, keeps you full", items: ["80g rolled oats", "3 whole eggs", "1 banana"], p: 34, f: 20, c: 81, cal: 631 },
    { name: "Lunch", note: "Protein first, then carbs", items: ["200g chicken breast", "80g white rice", "100g broccoli"], p: 51, f: 6, c: 64, cal: 532 },
    { name: "Snack", note: "Easy and high protein", items: ["250g Greek yogurt", "100g blueberries"], p: 26, f: 1, c: 23, cal: 205 },
    { name: "Dinner", note: "Fills the rest of your numbers", items: ["180g salmon", "300g potato", "150g green beans", "10g olive oil"], p: 43, f: 25, c: 60, cal: 645 }
  ];

  const PEOPLE = [
    { id: "demo-jordan", name: "Jordan", seed: 11, startW: 195, goalW: 180, endW: 188.4, schedule: PPL, workouts: WORKOUTS_PPL, meals: MEALS, plan: "cut", days: 34, last: 0, today: true,
      targets: { calories: 2000, protein: 150, fat: 56, fatCeiling: 56, carbs: 235, water: 120, steps: 10000 } },
    { id: "demo-maya", name: "Maya", seed: 23, startW: 148, goalW: 148, endW: 147.6, schedule: UL, workouts: WORKOUTS_UL, meals: [], plan: "recomp", days: 27, last: 3, today: false,
      targets: { calories: 1900, protein: 118, fat: 44, fatCeiling: 44, carbs: 258, water: 100, steps: 9000 } },
    { id: "demo-chris", name: "Chris", seed: 37, startW: 172, goalW: 182, endW: 175.2, schedule: PPL, workouts: WORKOUTS_PPL, meals: MEALS.map(m => Object.assign({}, m, { cal: Math.round(m.cal * 1.3), p: Math.round(m.p * 1.15), c: Math.round(m.c * 1.4), f: Math.round(m.f * 1.2) })), plan: "bulk", days: 20, last: 0, today: false, lowSleepYesterday: true,
      targets: { calories: 2800, protein: 140, fat: 52, fatCeiling: 52, carbs: 380, water: 120, steps: 8000 } }
  ];

  const FOOD_SAMPLES = [
    { n: "Chicken breast, cooked", cal: 330, p: 62, f: 7, c: 0, amt: "200 g" }, { n: "White rice, cooked", cal: 260, p: 5, f: 1, c: 56, amt: "200 g" },
    { n: "Greek yogurt, nonfat plain", cal: 145, p: 25, f: 1, c: 9, amt: "245 g" }, { n: "Banana", cal: 105, p: 1, f: 0, c: 27, amt: "1 medium" },
    { n: "Protein bar", cal: 200, p: 20, f: 7, c: 22, amt: "entered by hand" }, { n: "Egg, whole", cal: 215, p: 19, f: 14, c: 1, amt: "3 large egg" },
    { n: "Oats, rolled (dry)", cal: 311, p: 14, f: 6, c: 53, amt: "80 g" }, { n: "Salmon, cooked", cal: 370, p: 40, f: 22, c: 0, amt: "180 g" }
  ];

  function build(p) {
    const R = rng(p.seed), start = daysAgo(p.days), logs = [];
    const startKey = iso(start), cfgMeals = p.meals;
    const sessionNames = Object.keys(p.workouts);
    for (let i = p.days; i >= Math.max(p.last, p.today ? 0 : 1); i--) {
      const d = daysAgo(i), k = iso(d), frac = (p.days - i) / p.days, dow = d.getDay(), sched = p.schedule[dow];
      if (R() < 0.05 && i > 2) continue;                                   // an occasional missed day
      const day = { meals: [], water: Math.round(70 + R() * 55) };
      if (R() > 0.12) day.weight = Math.round((p.startW + (p.endW - p.startW) * Math.pow(frac, 0.9) + (R() - 0.5) * 1.2) * 10) / 10;
      day.steps = Math.round(6800 + R() * 6500);
      day.sleepHrs = Math.round((6.2 + R() * 2.2) * 4) / 4;
      const q = i < 14 ? 0.92 : 0.8;                                         // consistency improves over time
      if (cfgMeals.length) cfgMeals.forEach((m, idx) => { day.meals[idx] = R() < q; });
      else { day.foods = []; const n = 4 + Math.floor(R() * 3); for (let j = 0; j < n; j++) { const f = FOOD_SAMPLES[Math.floor(R() * FOOD_SAMPLES.length)]; day.foods.push(Object.assign({ slot: ["Breakfast", "Lunch", "Lunch", "Dinner", "Dinner", "Snack"][j % 6] }, f)); } }
      if (R() < 0.9) day.checkin = { n: R() < 0.8 ? 4 + Math.round(R()) : 3, i: R() < 0.75 ? 5 : 4, s: R() < 0.7 ? 4 : 3, h: 2, e: 4 };
      if (p.lowSleepYesterday && i === 1) day.checkin = { n: 3, i: 4, s: 2, h: 3, e: 2 };
      const lifts = {};
      if (sched !== "Rest" && R() < 0.93) {
        (p.workouts[sched] || []).forEach(ex => {
          const bump = Math.floor(((p.days - i) / 7) / 2) * 5, w = (BASE[ex] || 50) + bump;
          lifts[ex] = [0, 1, 2].map(s => ({ w: String(w), r: String(s === 2 ? 7 + Math.round(R()) : 8) }));
        });
      }
      logs.push({ log_date: k, day, lifts });
    }
    return { start: startKey, logs };
  }

  function configFor(p, startKey) {
    return { name: p.name, startDate: startKey, startWeight: p.startW, goalWeight: p.goalW, totalWeeks: 12, targets: p.targets,
      features: { goalBar: p.plan !== "recomp", streaks: true, offPlan: true, hungerEnergy: true, weeklyReview: true, photoReminder: false },
      coachNote: p.plan === "cut" ? "Strong week. Protein is on point. Keep the weigh-ins coming so I can see the trend." : "",
      weeklyReview: { title: "Week " + Math.ceil(p.days / 7) + " review", wins: "You checked in almost every day and your lifts are going up.", focus: p.meals.length ? "Hit every meal, especially breakfast." : "Log every food, even the small stuff." },
      weightLog: [{ date: startKey, w: p.startW }], meals: p.meals, mealNote: "All amounts are raw/uncooked. Weigh before cooking.",
      schedule: p.schedule, sets: 3, reps: 8, workouts: p.workouts,
      plan: [{ h: "Training", p: "Three sets of 6 to 8 on every exercise, taken close to failure. Keep the same exercises for 12 weeks and add weight or reps when you can." },
        { h: "Nutrition", p: "Protein is 0.8g per pound, fat is 0.3g per pound, and carbs fill the rest of your calories." },
        { h: "Daily targets", p: "Hit your steps, drink your water, weigh in every morning, and do your check-in at night." }] };
  }

  /* ---- tiny in-memory stand-in for the Supabase client ---- */
  function makeSb(db) {
    let nextId = 1000;
    const matches = (row, f) => f.every(([op, col, val]) => op === "eq" ? row[col] === val : op === "gte" ? row[col] >= val : op === "in" ? val.includes(row[col]) : true);
    function builder(table) {
      const st = { op: "select", filters: [], payload: null, order: null, limit: null, range: null, single: false, maybe: false, returning: false };
      const b = {
        select() { if (st.op !== "select") st.returning = true; return b; },
        insert(row) { st.op = "insert"; st.payload = row; return b; },
        update(row) { st.op = "update"; st.payload = row; return b; },
        upsert(row) { st.op = "upsert"; st.payload = row; return b; },
        delete() { st.op = "delete"; return b; },
        eq(c, v) { st.filters.push(["eq", c, v]); return b; },
        gte(c, v) { st.filters.push(["gte", c, v]); return b; },
        in(c, v) { st.filters.push(["in", c, v]); return b; },
        order(c, o) { st.order = [c, !(o && o.ascending === false)]; return b; },
        limit(n) { st.limit = n; return b; },
        range(a, z) { st.range = [a, z]; return b; },
        single() { st.single = true; return b; },
        maybeSingle() { st.maybe = true; return b; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); }
      };
      function run() {
        const rows = (db[table] = db[table] || []);
        if (st.op === "insert") { const r = Object.assign({ id: nextId++, created_at: new Date().toISOString(), read: false }, st.payload); rows.push(r); return { data: st.single ? r : [r], error: null }; }
        if (st.op === "upsert") {
          const keyCols = table === "day_logs" ? ["user_id", "log_date"] : ["user_id"];
          const ex = rows.find(r => keyCols.every(c => r[c] === st.payload[c]));
          if (ex) Object.assign(ex, st.payload); else rows.push(Object.assign({}, st.payload));
          return { data: null, error: null };
        }
        if (st.op === "update") { rows.filter(r => matches(r, st.filters)).forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
        if (st.op === "delete") { db[table] = rows.filter(r => !matches(r, st.filters)); return { data: null, error: null }; }
        let out = rows.filter(r => matches(r, st.filters));
        if (st.order) { const [c, asc] = st.order; out = out.slice().sort((a, z) => (a[c] > z[c] ? 1 : a[c] < z[c] ? -1 : 0) * (asc ? 1 : -1)); }
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        if (st.limit != null) out = out.slice(0, st.limit);
        out = out.map(r => JSON.parse(JSON.stringify(r)));
        if (st.single || st.maybe) return { data: out[0] || null, error: null };
        return { data: out, error: null };
      }
      return b;
    }
    return { from: builder, auth: { updateUser: async () => ({ error: null }), signOut: async () => ({}) },
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } };
  }

  window.DemoMode = {
    PEOPLE: PEOPLE.map(p => ({ id: p.id, name: p.name })),
    create(kind) {
      const db = { profiles: [{ id: "demo-coach", name: "Coach", role: "coach" }], client_config: [], day_logs: [], messages: [], saved_meals: [] };
      PEOPLE.forEach(p => {
        const { start, logs } = build(p);
        db.profiles.push({ id: p.id, name: p.name, role: "client" });
        db.client_config.push({ user_id: p.id, config: configFor(p, start) });
        logs.forEach(l => db.day_logs.push({ user_id: p.id, log_date: l.log_date, day: l.day, lifts: l.lifts }));
        if (p.today) {
          const k = iso(daysAgo(0)), ex = db.day_logs.find(r => r.user_id === p.id && r.log_date === k);
          const t = { meals: [true, false, false, false], water: 32, weight: p.endW, sleepHrs: 7.5 };
          const sess = p.schedule[daysAgo(0).getDay()], part = {};
          (sess !== "Rest" ? (p.workouts[sess] || []).slice(0, 3) : []).forEach(exn => { const w = String((BASE[exn] || 50) + 5); part[exn] = [{ w, r: "8" }, { w, r: "8" }, { w, r: "7" }]; });
          if (ex) { ex.day = t; ex.lifts = part; } else db.day_logs.push({ user_id: p.id, log_date: k, day: t, lifts: part });
        }
      });
      const now = Date.now(), hrs = h => new Date(now - h * 3600e3).toISOString();
      db.messages.push(
        { id: 1, client_id: "demo-jordan", sender: "client", body: "Hit a new best on incline press today!", created_at: hrs(30), read: true },
        { id: 2, client_id: "demo-jordan", sender: "coach", body: "Love to see it, Jordan. That's what consistency looks like. Keep it going this week.", created_at: hrs(26), read: false },
        { id: 3, client_id: "demo-maya", sender: "client", body: "Can I swap dinner on Friday? We have a family thing.", created_at: hrs(3), read: false });
      const one = id => ({ id, config: db.client_config.find(c => c.user_id === id).config, logs: db.day_logs.filter(r => r.user_id === id), messages: db.messages.filter(m => m.client_id === id) });
      return { sb: makeSb(db), db, client: id => one(PEOPLE.some(p => p.id === id) ? id : "demo-jordan") };
    }
  };
})();
