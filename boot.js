(() => {
  const view = document.getElementById("view");
  const tabs = document.getElementById("tabs");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Demo mode: fake data, no login, nothing saved. See app/demo.js.
  const DEMO_CTA = { text: "Join the Nov 1 launch", url: "https://awwabidris21.github.io/Coaching-Policies-/intake.html" };
  function startDemo(kind, as) {
    const demo = DemoMode.create(kind);
    document.body.classList.add("demo");
    document.body.insertAdjacentHTML("afterbegin", `<div class="demobar"><span>Demo with sample data. Nothing you tap here is saved.</span><a href="${esc(DEMO_CTA.url)}">${esc(DEMO_CTA.text)}</a></div>`);
    const back = () => { location.href = location.pathname + "?demo=" + encodeURIComponent(kind); };
    if (kind === "coach") {
      tabs.style.display = "none";
      document.addEventListener("click", e => {
        const a = e.target.closest('a[href^="?preview="]'); if (!a) return;
        e.preventDefault();
        location.href = location.pathname + "?demo=1&as=" + encodeURIComponent(new URLSearchParams(a.getAttribute("href").slice(1)).get("preview"));
      });
      startCoach({ sb: demo.sb, userId: "demo-coach", logout: back, switchToMe: back });
    } else {
      const c = demo.client(as);
      tabs.style.display = "";
      startClient({ sb: demo.sb, userId: c.id, config: c.config, logs: c.logs, messages: c.messages, logout: back });
    }
  }
  const demoKind = new URLSearchParams(location.search).get("demo");
  if (demoKind && window.DemoMode) { startDemo(demoKind === "coach" ? "coach" : "client", new URLSearchParams(location.search).get("as")); return; }

  if (typeof supabase === "undefined") {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><h1>Can't connect</h1><p class="muted">The app couldn't load. Check your internet connection and refresh.</p></div>`;
    return;
  }
  // Sessions are saved on the device and refreshed automatically, so people stay logged in.
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const logout = async () => { await sb.auth.signOut(); location.href = location.pathname; };
  const home = location.origin + location.pathname;

  // Password-reset emails link back here with a token in the URL.
  const hash = location.hash || "";
  const isRecovery = /type=recovery/.test(hash);
  const linkExpired = /error_code=otp_expired|error=access_denied/.test(hash);

  function message(title, text) {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><div class="eyebrow">Awwab Fitness</div><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>
      <div class="btns"><button class="btn ghost" id="lo">Log out</button></div></div>`;
    document.getElementById("lo").onclick = logout;
  }

  function showLogin(err, info) {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><div class="wm"><picture><source media="(prefers-color-scheme: dark)" srcset="logo-wordmark-dark.png?v=38"><img src="logo-wordmark-light.png?v=38" alt="Awwab Fitness"></picture></div><h1>Log in</h1>
      <form class="card" id="f" method="post" action="#"><label class="field" for="em">Email</label>
      <input id="em" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label class="field" for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}${info ? `<div class="muted small" style="margin-bottom:10px">${esc(info)}</div>` : ""}
      <button class="btn" style="width:100%" type="submit">Log in</button>
      <div style="text-align:center;margin-top:14px"><a href="#" id="fg" class="muted small">Forgot password?</a></div></form>
      <a class="btn ghost" style="width:100%;display:block;text-align:center;box-sizing:border-box;text-decoration:none;margin-bottom:12px" href="${location.pathname}?demo=1">Just looking? Try it out (sample data)</a>
      <p class="muted small">You'll stay logged in on this device. Tap "Save password" if your phone offers it.</p>
      <p class="muted small"><a href="https://awwabidris21.github.io/Coaching-Policies-/terms.html" target="_blank" rel="noopener">Terms</a> &middot; <a href="https://awwabidris21.github.io/Coaching-Policies-/privacy.html" target="_blank" rel="noopener">Privacy</a></p></div>`;
    document.getElementById("fg").onclick = e => { e.preventDefault(); showForgot(); };
    document.getElementById("f").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: document.getElementById("em").value.trim(), password: document.getElementById("pw").value });
      if (error) showLogin(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message); else boot();
    };
  }

  function showForgot(msg, ok) {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><div class="eyebrow">Awwab Fitness</div><h1>Reset password</h1>
      <p class="muted">Enter your email and we'll send you a link to choose a new password.</p>
      <form class="card" id="f"><label class="field" for="em">Email</label><input id="em" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" required>
      ${msg ? `<div class="${ok ? "muted small" : "err"}" style="margin-bottom:10px">${esc(msg)}</div>` : ""}
      <button class="btn" style="width:100%" type="submit">Send reset link</button>
      <div style="text-align:center;margin-top:14px"><a href="#" id="bk" class="muted small">Back to log in</a></div></form></div>`;
    document.getElementById("bk").onclick = e => { e.preventDefault(); showLogin(); };
    document.getElementById("f").onsubmit = async e => {
      e.preventDefault();
      const email = document.getElementById("em").value.trim();
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: home });
      if (error) showForgot(error.message.includes("rate") ? "Too many requests. Wait a few minutes and try again." : "We couldn't send that email. Check the address or ask your coach.");
      else showForgot("If that email has an account, a reset link is on its way. Check your inbox and spam.", true);
    };
  }

  function showNewPassword(msg) {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><div class="eyebrow">Awwab Fitness</div><h1>Choose a new password</h1>
      <form class="card" id="f"><label class="field" for="p1">New password (8 or more characters)</label><input id="p1" name="password" type="password" autocomplete="new-password" required>
      <label class="field" for="p2">Type it again</label><input id="p2" type="password" autocomplete="new-password" required>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ""}<button class="btn" style="width:100%" type="submit">Save password</button></form></div>`;
    document.getElementById("f").onsubmit = async e => {
      e.preventDefault();
      const a = document.getElementById("p1").value, b = document.getElementById("p2").value;
      if (a.length < 8) return showNewPassword("Use at least 8 characters.");
      if (a !== b) return showNewPassword("The two passwords don't match.");
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) return showNewPassword(error.message);
      history.replaceState(null, "", location.pathname);
      boot();
    };
  }

  async function preview(id, ctx) {
    const [who, cfg, logs, msgs] = await Promise.all([
      sb.from("profiles").select("name").eq("id", id).maybeSingle(),
      sb.from("client_config").select("config").eq("user_id", id).maybeSingle(),
      sb.from("day_logs").select("log_date,day,lifts").eq("user_id", id),
      sb.from("messages").select("id,sender,body,created_at,read").eq("client_id", id).order("created_at", { ascending: true })
    ]);
    if (!cfg.data || !cfg.data.config || !cfg.data.config.meals) return message("No plan yet", "This client doesn't have a plan set up yet.");
    document.body.classList.add("preview");
    document.body.insertAdjacentHTML("afterbegin", `<div class="previewbar"><span>Preview: ${esc((who.data && who.data.name) || "client")} (read only)</span><a href="${esc(location.pathname)}?coach=1">Back to coach view</a></div>`);
    tabs.style.display = "";
    startClient({ sb, userId: id, readOnly: true, config: cfg.data.config, logs: logs.data || [], messages: msgs.data || [], logout: () => { location.href = location.pathname + "?coach=1"; } });
  }

  async function startOwn(user, ctx) {
    const [cfg, logs, msgs] = await Promise.all([
      sb.from("client_config").select("config").eq("user_id", user.id).maybeSingle(),
      sb.from("day_logs").select("log_date,day,lifts").eq("user_id", user.id),
      sb.from("messages").select("id,sender,body,created_at,read").eq("client_id", user.id).order("created_at", { ascending: true })
    ]);
    if (!cfg.data || !cfg.data.config || !cfg.data.config.meals) {
      tabs.style.display = "none";
      view.innerHTML = `<div class="login"><div class="eyebrow">Awwab Fitness</div><h1>Your own plan isn't set up yet</h1><p class="muted">Ask Claude to load your plan, then come back here.</p>
        <div class="btns"><button class="btn" id="tc">Back to coach view</button></div></div>`;
      document.getElementById("tc").onclick = ctx.switchToCoach;
      return;
    }
    ctx.config = cfg.data.config; ctx.logs = logs.data || []; ctx.messages = msgs.data || []; ctx.isSelf = true;
    tabs.style.display = "";
    startClient(ctx);
  }

  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    const user = session.user;
    const pr = await sb.from("profiles").select("id,role,name").eq("id", user.id).maybeSingle();
    if (pr.error) return message("Can't load your profile", pr.error.message);
    let prof = pr.data;
    if (!prof) {
      const ins = await sb.from("profiles").insert({ id: user.id, role: "client", name: (user.email || "").split("@")[0] });
      if (ins.error) return message("Almost there", "Your account isn't set up yet. Tell your coach. (" + ins.error.message + ")");
      prof = { id: user.id, role: "client", name: (user.email || "").split("@")[0] };
    }
    const ctx = { sb, userId: user.id, logout };
    if (prof.role === "coach") {
      const qs = new URLSearchParams(location.search);
      if (qs.get("preview")) return preview(qs.get("preview"), ctx);
      if (qs.get("results")) { tabs.style.display = "none"; return startResults(ctx, qs.get("results")); }
      // Coaches can also use the app for themselves ("My app"); the choice is remembered on this device.
      let mode = "coach";
      try { mode = localStorage.getItem("coachMode") || "coach"; } catch (e) {}
      if (qs.get("me") === "1") mode = "me"; else if (qs.get("coach") === "1") mode = "coach";
      try { localStorage.setItem("coachMode", mode); } catch (e) {}
      if (qs.has("me") || qs.has("coach")) history.replaceState(null, "", location.pathname);
      const go = m => { try { localStorage.setItem("coachMode", m); } catch (e) {} location.href = location.pathname; };
      ctx.switchToMe = () => go("me");
      ctx.switchToCoach = () => go("coach");
      if (mode === "me") return startOwn(user, ctx);
      tabs.style.display = "none"; return startCoach(ctx);
    }

    const [cfg, logs, msgs] = await Promise.all([
      sb.from("client_config").select("config").eq("user_id", user.id).maybeSingle(),
      sb.from("day_logs").select("log_date,day,lifts").eq("user_id", user.id),
      sb.from("messages").select("id,sender,body,created_at,read").eq("client_id", user.id).order("created_at", { ascending: true })
    ]);
    if (!cfg.data || !cfg.data.config || !cfg.data.config.meals) return message("Plan coming soon", "Your coach is still setting up your plan. Check back soon.");
    ctx.config = cfg.data.config;
    ctx.logs = logs.data || [];
    ctx.messages = msgs.data || [];
    tabs.style.display = "";
    startClient(ctx);
  }

  if (isRecovery) showNewPassword();
  else if (linkExpired) { history.replaceState(null, "", location.pathname); showForgot("That reset link expired. Request a new one."); }
  else boot();
})();
