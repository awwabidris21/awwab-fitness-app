/* Two-week macro review. Pure functions (no DOM, no network) so the rules can be tested on their own.
   The coach screen feeds it a client's plan, weigh-ins and logged calories and shows what it proposes. Nothing is applied without the coach tapping Approve.
   Defaults (percent of bodyweight per week) are typical coaching ranges and can be overridden per client in config.autoAdjust. */
window.AutoReview = (() => {
  const RANGES = { cut: [-1.0, -0.5], bulk: [0.25, 0.5], recomp: [-0.25, 0.25] };
  const CYCLE_DAYS = 14, MIN_WEIGH_INS = 6, MIN_LOGGED_DAYS = 10, DEFAULT_FLOOR = 1500, MIN_CARBS = 100;
  const toDate = k => new Date(k + "T12:00:00");
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const addDays = (k, n) => { const d = toDate(k); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const r1 = x => Math.round(x * 10) / 10;

  function goalOf(cfg) {
    const a = cfg.autoAdjust || {};
    if (a.goal) return a.goal;
    const s = +cfg.startWeight || 0, g = +cfg.goalWeight || 0;
    if (s && g && g < s - 1) return "cut";
    if (s && g && g > s + 1) return "bulk";
    return "recomp";
  }
  const rangeOf = (cfg, goal) => { const r = (cfg.autoAdjust || {}).rate; return Array.isArray(r) && r.length === 2 ? r : RANGES[goal]; };

  // the cycle restarts at the plan's start date, or at the latest macro change or review
  function cycleStart(cfg) {
    const dates = [cfg.startDate].concat((cfg.macroLog || []).map(x => x.date), (cfg.autoLog || []).map(x => x.date)).filter(Boolean);
    return dates.sort().pop();
  }

  /* input: { cfg, today: "YYYY-MM-DD", weights: [{date, w}], cals: { "YYYY-MM-DD": caloriesLogged } } */
  function evaluate(input) {
    const { cfg, today, weights, cals } = input, a = cfg.autoAdjust || {}, T = cfg.targets || {};
    const goal = goalOf(cfg), range = rangeOf(cfg, goal);
    const out = { goal, range };
    if (a.enabled === false) return Object.assign(out, { state: "off", msg: "Reviews are switched off for this client." });
    if (!T.calories) return Object.assign(out, { state: "off", msg: "Set this client's calories first." });

    const start = cycleStart(cfg) || today, day = daysBetween(start, today);
    out.cycleStart = start; out.cycleDay = day; out.dueOn = addDays(start, CYCLE_DAYS);
    if (day < CYCLE_DAYS) return Object.assign(out, { state: "wait", msg: `Next review on ${out.dueOn} (day ${day} of ${CYCLE_DAYS}).` });

    const end = addDays(today, -1);
    const wk1 = weights.filter(x => x.date > addDays(end, -7) && x.date <= end), wk0 = weights.filter(x => x.date > addDays(end, -14) && x.date <= addDays(end, -7));
    out.weighIns = wk0.length + wk1.length;
    if (out.weighIns < MIN_WEIGH_INS || wk0.length < 2 || wk1.length < 2) {
      return Object.assign(out, { state: "needData", focus: "Weigh in every morning so I can read your trend.", msg: `Not enough weigh-ins to read a trend: ${out.weighIns} in the last 14 days (need ${MIN_WEIGH_INS}, at least 2 each week).` });
    }
    const dayKeys = []; for (let i = 13; i >= 0; i--) dayKeys.push(addDays(end, -i));
    const logged = dayKeys.filter(k => (cals[k] || 0) >= 0.5 * T.calories);
    out.loggedDays = logged.length;
    out.calRatio = logged.length ? avg(logged.map(k => cals[k])) / T.calories : 0;
    if (logged.length < MIN_LOGGED_DAYS) {
      return Object.assign(out, { state: "adherence", focus: "Log everything you eat, every day.", msg: `Food was logged on ${logged.length} of the last 14 days (need ${MIN_LOGGED_DAYS}). Fix tracking before changing the numbers.` });
    }
    if (out.calRatio < 0.85 || out.calRatio > 1.15) {
      return Object.assign(out, { state: "adherence", focus: out.calRatio < 0.85 ? "Eat to your calorie target. You're coming in under." : "Stay closer to your calorie target. You're going over.", msg: `They averaged ${Math.round(out.calRatio * 100)}% of the calorie target on logged days. Get them following the plan before adjusting it.` });
    }

    const m0 = avg(wk0.map(x => x.w)), m1 = avg(wk1.map(x => x.w)), perWeek = m1 - m0, ratePct = perWeek / m1 * 100;
    Object.assign(out, { m0: r1(m0), m1: r1(m1), perWeek: r1(perWeek), ratePct: Math.round(ratePct * 100) / 100 });
    if (goal === "cut" && cfg.goalWeight && m1 <= +cfg.goalWeight + 0.5) {
      return Object.assign(out, { state: "goal", msg: `Average weight ${out.m1} lb is at the ${cfg.goalWeight} lb goal. Consider moving to maintenance.` });
    }
    const [lo, hi] = range;
    if (ratePct >= lo && ratePct <= hi) {
      return Object.assign(out, { state: "ontrack", msg: `On track: ${out.perWeek > 0 ? "+" : ""}${out.perWeek} lb/week (${out.ratePct}%), inside the ${lo}% to ${hi}% target. No change.` });
    }
    const below = ratePct < lo, gap = below ? lo - ratePct : ratePct - hi;
    let delta = (gap >= 0.4 ? 150 : 100) * (below ? 1 : -1);
    const floor = +a.floor || DEFAULT_FLOOR;
    let newCal = Math.round(T.calories + delta);
    if (newCal < floor) {
      return Object.assign(out, { state: "floor", msg: `Trend says cut calories, but ${newCal} would go under the ${floor} calorie floor. Look at steps and training instead.` });
    }
    const p = Math.round(0.8 * m1), fc = Math.round(0.3 * m1), f = +T.fat || fc, c = Math.max(0, Math.round((newCal - 4 * p - 9 * f) / 4));
    if (c < MIN_CARBS && delta < 0) {
      return Object.assign(out, { state: "floor", msg: `Carbs would drop to ${c} g. Protein and fat are fixed, so look at steps and training instead.` });
    }
    const verdict = { cut: below ? "you're losing faster than the target" : "you're losing slower than the target", bulk: below ? "you're gaining slower than the target" : "you're gaining faster than the target", recomp: below ? "your weight is dropping" : "your weight is creeping up" }[goal] || "you're off the target";
    const reason = `Your average weight went from ${r1(m0)} lb (first week) to ${r1(m1)} lb (second week), ${out.perWeek > 0 ? "+" : ""}${out.perWeek} lb a week. Target: ${targetText(goal, range)}. Right now ${verdict}, so calories go ${delta > 0 ? "up" : "down"} ${Math.abs(delta)}.`;
    return Object.assign(out, { state: "propose", delta, newCal, macros: { cal: newCal, p, f, c, fc }, reason });
  }
  function targetText(goal, [lo, hi]) {
    if (lo < 0 && hi < 0) return `lose ${Math.abs(hi)}% to ${Math.abs(lo)}% of bodyweight per week`;
    if (lo > 0 && hi > 0) return `gain ${lo}% to ${hi}% of bodyweight per week`;
    return `stay within ${Math.max(Math.abs(lo), Math.abs(hi))}% of the same weight per week`;
  }

  // the message the client reads in the app (and the coach can paste as a text)
  function explain(name, ev, oldT) {
    const m = ev.macros;
    return `Hey ${name || "there"}, your numbers are updating. ${ev.reason} New daily targets: ${m.cal} calories (was ${oldT.calories}), ${m.p}g protein, ${m.c}g carbs, ${m.f}g fat. Protein stays high and carbs take the change. Start today, and message me if anything feels off.`;
  }

  return { evaluate, explain, goalOf, rangeOf, RANGES, CYCLE_DAYS, addDays };
})();
