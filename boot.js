(() => {
  const view = document.getElementById("view");
  const tabs = document.getElementById("tabs");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  if (typeof supabase === "undefined") {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><h1>Can't connect</h1><p class="muted">The app couldn't load. Check your internet connection and refresh.</p></div>`;
    return;
  }
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const logout = async () => { await sb.auth.signOut(); location.reload(); };

  function message(title, text) {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><div class="eyebrow">Awwab Fitness</div><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>
      <div class="btns"><button class="btn ghost" id="lo">Log out</button></div></div>`;
    document.getElementById("lo").onclick = logout;
  }

  function showLogin(err) {
    tabs.style.display = "none";
    view.innerHTML = `<div class="login"><div class="eyebrow">Awwab Fitness</div><h1>Log in</h1>
      <form class="card" id="f"><label class="field" for="em">Email</label><input id="em" type="text" inputmode="email" autocomplete="username" autocapitalize="none" required>
      <label class="field" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}<button class="btn" style="width:100%" type="submit">Log in</button></form>
      <p class="muted small">Your coach gives you your login.</p></div>`;
    document.getElementById("f").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: document.getElementById("em").value.trim(), password: document.getElementById("pw").value });
      if (error) showLogin(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message); else boot();
    };
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
    if (prof.role === "coach") { tabs.style.display = "none"; return startCoach(ctx); }

    const [cfg, logs] = await Promise.all([
      sb.from("client_config").select("config").eq("user_id", user.id).maybeSingle(),
      sb.from("day_logs").select("log_date,day,lifts").eq("user_id", user.id)
    ]);
    if (!cfg.data || !cfg.data.config || !cfg.data.config.meals) return message("Plan coming soon", "Your coach is still setting up your plan. Check back soon.");
    ctx.config = cfg.data.config;
    ctx.logs = logs.data || [];
    tabs.style.display = "";
    startClient(ctx);
  }

  boot();
})();
