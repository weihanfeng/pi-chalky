// Browser half of the login extension: /login and /logout open a dialog in the middle of the page, as /mcp does
// (a click on the backdrop, Esc or ✕ closes it; closing it during a sign-in cancels the sign-in).
//   list      Sign in (pi's providers) and custom endpoints, each "connected" / "sign in again" (GET /login)
//   sign-in   what pi asks for, as it asks (event "login"): a link to open, a code to type, a choice, a box to paste
//             into; ✕ cancels
//   custom    name, API type, base URL, key (optional), model names as chips (Enter or "," after each; a paste is
//             split); "Ask the endpoint" lists its models to pick from
//   logout    the saved logins, each with Log out / Remove
//   model     (/model, and after connecting) the usable models, grouped by provider; "Use for" all agents or one agent
//             (an agent's own choice wins; "Same as all agents" drops it). A tick shows which agents use a model now
// The server does the work (index.ts); keys typed here go to it once and never come back. CHALKY_LOGIN=off: no commands.
export default function (page) {
  const APIS = { "openai-completions": "OpenAI", "openai-responses": "OpenAI Responses", "anthropic-messages": "Anthropic",
                 "google-generative-ai": "Google" };  // the API the endpoint speaks
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const style = document.createElement("style");
  style.textContent = `
    #login { width: min(560px, calc(100vw - 32px)); max-height: 75vh; padding: 0; box-sizing: border-box; color: var(--text);
             background: var(--glass-strong); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
             border: 1px solid var(--edge); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; font-size: 13px; }
    #login[open] { display: flex; flex-direction: column; }
    #login::backdrop { background: rgba(0, 0, 0, .08); }
    #login:focus { outline: none; }
    #login .body > .btns:last-child { position: sticky; bottom: -16px; margin: 0 -14px -16px; padding: 10px 14px;
                                      background: var(--glass-strong); border-top: 1px solid var(--line); }  /* Use / Save stay in view */
    #login .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: 600; }
    #login .head button { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-weight: 400; cursor: pointer; }
    #login .head .x { margin-left: auto; color: var(--muted); font-size: 15px; }
    #login .body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 16px; display: grid; gap: 12px; align-content: start;
                   grid-auto-rows: max-content; }  /* rows keep their height: the body scrolls, not each list */
    #login .group { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 4px 0 -6px; }
    #login .rows { display: grid; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    #login .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; }
    #login .row + .row { border-top: 1px solid var(--line); }
    #login .row:hover { background: var(--hover); }
    #login .row .how { margin-left: auto; font-size: 11px; color: var(--muted); white-space: nowrap; }
    #login .dot { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; flex: none;
                  background: var(--hover); color: var(--soft); font-weight: 600; font-size: 11px; }
    #login .chip { font-size: 10.5px; padding: 1px 7px; border-radius: 99px; white-space: nowrap; margin-left: auto; }
    #login .chip.ok { background: rgba(52, 199, 89, 0.14); color: #1f8a3e; }
    #login .chip.expired { background: rgba(255, 159, 10, 0.16); color: #b25e00; }
    #login label { display: grid; gap: 5px; font-size: 12px; color: var(--soft); }
    #login input, #login select { font: inherit; color: var(--text); background: rgba(255, 255, 255, 0.9); border: 1px solid var(--line);
                                  border-radius: 9px; padding: 7px 10px; outline: none; min-width: 0; }
    #login input:focus, #login select:focus, #login .tags:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.12); }
    #login .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; }
    #login .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    #login .btns { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    #login .btn { border: 0; border-radius: 9px; padding: 7px 14px; font: 500 13px inherit; font-family: inherit; cursor: pointer;
                  background: var(--hover); color: var(--text); text-decoration: none; }
    #login .btn.primary { background: var(--accent); color: #fff; }
    #login .btn.small { padding: 3px 10px; font-size: 12px; }
    #login .btn:disabled { opacity: 0.5; cursor: default; }
    #login .hint { font-size: 11.5px; color: var(--muted); }
    #login .row .hint { white-space: nowrap; }
    #login .error { color: var(--danger); font-size: 12.5px; }
    #login .wait { display: flex; gap: 10px; align-items: center; color: var(--soft); }
    #login .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(0, 113, 227, 0.15); border-top-color: var(--accent);
                   animation: login-spin 1s linear infinite; flex: none; }
    @keyframes login-spin { to { transform: rotate(360deg) } }
    #login .code { font: 600 26px ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.12em; text-align: center; padding: 14px;
                   border-radius: 10px; background: rgba(255, 255, 255, 0.9); border: 1px dashed var(--line); user-select: all; }
    #login details summary { cursor: pointer; color: var(--accent); font-size: 12.5px; }
    #login details[open] summary { margin-bottom: 8px; }
    #login .tags { display: flex; flex-wrap: wrap; gap: 6px; background: rgba(255, 255, 255, 0.9); border: 1px solid var(--line); border-radius: 9px; padding: 5px; }
    #login .tags input { border: 0; box-shadow: none; padding: 3px 4px; flex: 1; min-width: 120px; background: none; }
    #login .tag { font: 12px ui-monospace, "SF Mono", Menlo, monospace; background: rgba(0, 113, 227, 0.1); border-radius: 6px;
                  padding: 3px 4px 3px 8px; display: inline-flex; gap: 2px; align-items: center; }
    #login .tag button { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 0 4px; font-size: 11px; }
    #login .found { max-height: 150px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 4px; }
    #login .found button { border: 1px solid var(--line); background: none; border-radius: 6px; padding: 2px 7px; cursor: pointer;
                           font: 11.5px ui-monospace, "SF Mono", Menlo, monospace; color: var(--soft); }
    #login .found button:hover { background: var(--hover); color: var(--text); }
    #login .for { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--soft); }
    #login .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    #login .seg button { border: 0; background: none; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; color: var(--text); }
    #login .seg button.on { background: var(--accent); color: #fff; }
    #login .radio { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--muted); flex: none; box-sizing: border-box; }
    #login .row.on .radio { border: 4.5px solid var(--accent); }
    #login .model-id { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }`;
  document.head.append(style);

  const sheet = document.createElement("dialog");
  sheet.id = "login";
  document.body.append(sheet);
  sheet.onclick = (e) => { if (e.target === sheet) sheet.close(); };  // a click on the backdrop closes it
  sheet.onclose = () => {  // ✕, Esc, the backdrop, Done
    if (view === "signin") page.send({ type: "login_cancel" });
    view = signing = form = null;
  };

  let view = null;      // "list" | "signin" | "custom" | "logout" | "done"
  let signing = null;   // the provider being signed in to
  let form = null;      // the custom form's state: {id, editing, api, baseUrl, models: [], found: []}

  function open(next) {
    if (!sheet.open) sheet.showModal();
    next();
  }
  const close = () => sheet.close();

  function draw(title, body, back) {
    sheet.innerHTML = `<div class="head">${back ? `<button class="back">‹ Back</button>` : ""}${esc(title)}<button class="x" title="Close">✕</button></div>
      <div class="body">${body}</div>`;
    sheet.querySelector(".x").onclick = close;
    if (back) sheet.querySelector(".back").onclick = back;
    return sheet.querySelector(".body");
  }
  const chip = (status) => status === "connected" ? `<span class="chip ok">connected</span>`
    : status === "expired" ? `<span class="chip expired">sign in again</span>` : "";
  const fetchList = () => fetch("/login").then((r) => r.ok ? r.json() : Promise.reject(new Error(`/login: ${r.status}`)));

  // ---- the list
  async function showList() {
    view = "list";
    const body = draw("Connect a model", `<div class="wait"><span class="spin"></span>Checking your logins…</div>`);
    let data;
    try { data = await fetchList(); } catch (e) { body.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    if (view !== "list") return;
    body.innerHTML = `<input class="search" placeholder="Search…" aria-label="Search">
      <div class="group">Sign in</div>
      <div class="rows signin">${data.providers.map((p) => `<div class="row" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
        <span class="dot">${esc(p.name[0])}</span>${esc(p.name)}${p.subscription ? "" : `<span class="hint">not a subscription</span>`}
        ${chip(p.status) || `<span class="how">sign in</span>`}</div>`).join("")}</div>
      <div class="group">Custom endpoints</div>
      <div class="rows custom">${data.custom.map((c) => `<div class="row" data-id="${esc(c.id)}">
        <span class="dot">${esc(c.id[0].toUpperCase())}</span>${esc(c.id)} <span class="hint">${esc(c.models.length)} model${c.models.length === 1 ? "" : "s"}</span>
        ${chip(c.status) || `<span class="how">edit</span>`}</div>`).join("")}
        <div class="row new"><span class="dot">+</span>Custom endpoint<span class="how">URL · key · models</span></div></div>`;
    const search = body.querySelector(".search");
    search.oninput = () => {
      const q = search.value.toLowerCase();
      for (const r of body.querySelectorAll(".row:not(.new)")) r.style.display = `${r.dataset.id} ${r.dataset.name ?? ""}`.toLowerCase().includes(q) ? "" : "none";
    };
    search.focus();
    for (const r of body.querySelectorAll(".signin .row")) r.onclick = () => startSignIn(r.dataset.id, r.dataset.name);
    for (const r of body.querySelectorAll(".custom .row:not(.new)"))
      r.onclick = () => showCustom(data.custom.find((c) => c.id === r.dataset.id));
    body.querySelector(".row.new").onclick = () => showCustom();
  }

  // ---- sign in: the sheet shows what pi asks for, as it asks
  function startSignIn(id, name) {
    view = "signin";
    signing = { id, name };
    const body = draw(name, `<div class="link"></div><div class="wait"><span class="spin"></span><span class="msg">Starting…</span></div>
      <div class="ask"></div><div class="error"></div>`, () => { page.send({ type: "login_cancel" }); showList(); });
    body.dataset.provider = id;
    page.send({ type: "login_start", provider: id });
  }
  function onSignIn(ev) {
    const body = sheet.querySelector(".body");
    if (view !== "signin" || !body) return;
    const msg = body.querySelector(".msg"), link = body.querySelector(".link"), ask = body.querySelector(".ask");
    if (ev.step === "notify") {
      const e = ev.event;
      if (e.type === "auth_url") {
        link.innerHTML = `<div class="btns" style="justify-content:flex-start"><a class="btn primary" target="_blank" rel="noopener"
          href="${esc(e.url)}">Open the ${esc(signing.name)} sign-in page ↗</a></div>`;
        msg.textContent = "Waiting for you to finish in the other tab…";
      } else if (e.type === "device_code") {
        link.innerHTML = `<div class="hint" style="text-align:center">Go to <a target="_blank" rel="noopener" href="${esc(e.verificationUri)}">${esc(e.verificationUri)}</a> and enter</div>
          <div class="code">${esc(e.userCode)}</div>
          <div class="btns" style="justify-content:center"><button class="btn copy">Copy code</button>
          <a class="btn primary" target="_blank" rel="noopener" href="${esc(e.verificationUri)}">Open ↗</a></div>`;
        link.querySelector(".copy").onclick = () => navigator.clipboard?.writeText(e.userCode);
        msg.textContent = "Waiting…";
      } else msg.textContent = e.message;  // progress, info
    }
    if (ev.step === "prompt") {
      const p = ev.prompt;
      if (p.type === "select") {
        ask.innerHTML = `<div class="hint">${esc(p.message)}</div><div class="rows">${p.options.map((o) =>
          `<div class="row" data-id="${esc(o.id)}">${esc(o.label)}</div>`).join("")}</div>`;
        for (const r of ask.querySelectorAll(".row")) r.onclick = () => { ask.innerHTML = ""; page.send({ type: "login_answer", text: r.dataset.id }); };
        msg.textContent = "Choose one:";
        return;
      }
      // text, secret, manual_code: a box to type or paste into. manual_code goes with a link already open: tucked away
      const field = `<label>${esc(p.message)}<input class="mono" type="${p.type === "secret" ? "password" : "text"}"
        placeholder="${esc(p.placeholder ?? "")}"></label><div class="btns"><button class="btn primary">Continue</button></div>`;
      ask.innerHTML = p.type === "manual_code" ? `<details><summary>The page after signing in didn't load?</summary>${field}</details>` : field;
      const input = ask.querySelector("input"), go = () => { page.send({ type: "login_answer", text: input.value }); ask.innerHTML = ""; msg.textContent = "Checking…"; };
      ask.querySelector(".btn").onclick = go;
      input.onkeydown = (e) => { if (e.key === "Enter") go(); };
      if (p.type !== "manual_code") input.focus();
    }
    if (ev.step === "prompt_done") ask.innerHTML = "";
  }

  // ---- custom endpoint
  function showCustom(c) {
    view = "custom";
    form = { editing: !!c, found: [], models: [...(c?.models ?? [])] };
    const body = draw(c ? c.id : "Custom endpoint", `
      <div class="two"><label>Name<input class="id" value="${esc(c?.id ?? "")}" placeholder="openrouter" ${c ? "disabled" : ""}></label>
        <label>Speaks<select class="api">${Object.entries(APIS).map(([v, l]) => `<option value="${v}" ${v === (c?.api ?? "openai-completions") ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <label>Base URL<input class="url mono" value="${esc(c?.baseUrl ?? "")}" placeholder="https://openrouter.ai/api/v1"></label>
      <label><span>API key <span class="hint">(optional${c ? "; leave empty to keep the saved one" : ""})</span></span><input class="key mono" type="password" autocomplete="off"></label>
      <label><span>Models <span class="hint">(Enter or "," after each; paste several at once)</span></span><div class="tags"><input class="add mono" placeholder="model name"></div></label>
      <div class="found"></div>
      <div class="error"></div>
      <div class="btns" style="justify-content:space-between"><button class="btn ask">Ask the endpoint</button><button class="btn primary save">Save</button></div>`,
      showList);
    const tags = body.querySelector(".tags"), add = body.querySelector(".add"), found = body.querySelector(".found");
    const drawTags = () => {
      for (const t of tags.querySelectorAll(".tag")) t.remove();
      for (const m of form.models) {
        const t = document.createElement("span");
        t.className = "tag";
        t.innerHTML = `${esc(m)}<button title="Remove">✕</button>`;
        t.querySelector("button").onclick = (e) => { e.preventDefault(); form.models = form.models.filter((x) => x !== m); drawTags(); drawFound(); };
        tags.insertBefore(t, add);
      }
    };
    const drawFound = () => {  // the endpoint's own names, narrowed by what is being typed; click one to add it
      const q = add.value.trim().toLowerCase();
      const left = form.found.filter((m) => !form.models.includes(m) && m.toLowerCase().includes(q));
      found.innerHTML = left.slice(0, 200).map((m) => `<button data-m="${esc(m)}">${esc(m)}</button>`).join("")
        + (left.length > 200 ? `<span class="hint">${left.length - 200} more: type to narrow</span>` : "");
      for (const b of found.querySelectorAll("button")) b.onclick = () => addNames([b.dataset.m]);
    };
    const addNames = (names) => {
      for (const n of names.map((s) => s.trim()).filter(Boolean)) if (!form.models.includes(n)) form.models.push(n);
      add.value = "";
      drawTags(); drawFound();
    };
    add.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addNames(add.value.split(",")); }
      else if (e.key === "Backspace" && !add.value && form.models.length) { form.models.pop(); drawTags(); drawFound(); }
    };
    add.oninput = drawFound;
    add.onpaste = (e) => { e.preventDefault(); addNames((e.clipboardData.getData("text") || "").split(/[\s,]+/)); };
    tags.onclick = () => add.focus();
    drawTags();
    const value = (sel) => body.querySelector(sel).value.trim();
    body.querySelector(".ask").onclick = () => {
      body.querySelector(".error").textContent = "";
      found.innerHTML = `<span class="hint">Asking…</span>`;
      page.send({ type: "login_list_models", id: c?.id, api: value(".api"), baseUrl: value(".url"), key: value(".key") });
    };
    body.querySelector(".save").onclick = () => {
      if (add.value.trim()) addNames(add.value.split(","));  // names typed but not yet added
      body.querySelector(".error").textContent = "";
      body.querySelector(".save").disabled = true;
      page.send({ type: "login_custom", id: value(".id"), api: value(".api"), baseUrl: value(".url"), key: value(".key"), models: form.models });
    };
    (c ? add : body.querySelector(".id")).focus();
  }

  // ---- logout
  async function showLogout() {
    view = "logout";
    const body = draw("Saved logins", `<div class="wait"><span class="spin"></span>Loading…</div>`);
    let data;
    try { data = await fetchList(); } catch (e) { body.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    if (view !== "logout") return;
    const rows = [...data.providers.filter((p) => p.status).map((p) => ({ id: p.id, name: p.name, how: p.status === "expired" ? "expired" : "signed in", act: "Log out" })),
                  ...data.custom.map((c) => ({ id: c.id, name: `${c.id} (custom)`, how: c.status ? "key" : "no key", act: "Remove" }))];
    body.innerHTML = rows.length ? `<div class="rows">${rows.map((r) => `<div class="row" data-id="${esc(r.id)}"><span class="dot">${esc(r.name[0].toUpperCase())}</span>
      ${esc(r.name)}<span class="how">${r.how}</span><button class="btn small">${r.act}</button></div>`).join("")}</div>
      <div class="hint">Log out removes the login from this machine (app/auth.json). Remove also deletes the endpoint.</div>`
      : `<div class="hint">No saved logins. Type /login to add one.</div>`;
    for (const b of body.querySelectorAll(".row .btn")) b.onclick = () => {
      b.disabled = true;
      page.send({ type: "logout", provider: b.closest(".row").dataset.id });
    };
  }

  // ---- choose the model
  async function showModels(title = "Choose the model") {
    view = "model";
    const body = draw(title, `<div class="wait"><span class="spin"></span>Loading models…</div>`);
    let data;
    try { data = await fetch("/login/models").then((r) => r.ok ? r.json() : Promise.reject(new Error(`/login/models: ${r.status}`))); }
    catch (e) { body.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    if (view !== "model") return;
    const key = (m) => m ? `${m.provider}/${m.id}` : "same";
    const firstAgentModel = data.agents[0]?.model;
    form = { scope: "all", pick: key(data.default ?? firstAgentModel) };
    const label = (k) => k === "same" ? "the all-agents model" : k.slice(k.indexOf("/") + 1);
    function render() {
      const agent = data.agents.find((a) => a.name === form.scope);
      const users = (k) => data.agents.filter((a) => key(a.model) === k).map((a) => a.name);
      body.innerHTML = `<div class="for">Use for <span class="seg"><button data-for="all" class="${form.scope === "all" ? "on" : ""}">All agents</button>${data.agents.map((a) =>
          `<button data-for="${esc(a.name)}" class="${form.scope === a.name ? "on" : ""}">${esc(a.name)}</button>`).join("")}</span></div>
        <div class="hint">${agent ? `Only ${esc(agent.name)}; the others keep theirs.` : "Every agent that hasn't picked its own."}</div>
        <input class="search" placeholder="Search models…" aria-label="Search models">
        ${agent ? `<div class="rows"><div class="row ${form.pick === "same" ? "on" : ""}" data-k="same"><span class="radio"></span>Same as all agents
          <span class="how">${esc(data.default ? data.default.id : "MODEL_BASE_URL")}</span></div></div>` : ""}
        ${data.groups.map((g) => `<div class="group">${esc(g.name)}</div><div class="rows">${g.models.map((m) => {
          const k = `${g.provider}/${m.id}`, who = users(k);
          return `<div class="row ${form.pick === k ? "on" : ""}" data-k="${esc(k)}" data-q="${esc(`${g.name} ${m.id} ${m.name}`.toLowerCase())}"><span class="radio"></span>
            <span class="model-id">${esc(m.id)}</span><span class="how">${who.map((n) => `${esc(n)} ✓`).join(" ")}${who.length && m.context ? " · " : ""}${m.context ? `${Math.round(m.context / 1000)}k` : ""}</span></div>`;
        }).join("")}</div>`).join("") || `<div class="hint">No models yet: type /login to connect one.</div>`}
        <div class="error"></div>
        <div class="btns"><button class="btn primary use">Use ${esc(label(form.pick))}</button></div>`;
      for (const b of body.querySelectorAll(".seg button")) b.onclick = () => {
        form.scope = b.dataset.for;
        const a = data.agents.find((x) => x.name === form.scope);
        form.pick = a ? (a.own ? key(a.model) : "same") : key(data.default ?? firstAgentModel);
        render();
      };
      for (const r of body.querySelectorAll(".row[data-k]")) r.onclick = () => {
        form.pick = r.dataset.k;
        for (const x of body.querySelectorAll(".row.on")) x.classList.remove("on");
        r.classList.add("on");
        body.querySelector(".use").textContent = `Use ${label(form.pick)}`;
      };
      const search = body.querySelector(".search");
      search.oninput = () => {
        const q = search.value.toLowerCase();
        for (const r of body.querySelectorAll(".row[data-q]")) r.style.display = r.dataset.q.includes(q) ? "" : "none";
      };
      body.querySelector(".use").onclick = () => {
        const [provider, ...rest] = form.pick === "same" ? [] : form.pick.split("/");
        if (form.scope === "all" && !provider) return;
        form.said = form.scope === "all" ? `all agents now use ${rest.join("/")}`
          : provider ? `${form.scope} now uses ${rest.join("/")}` : `${form.scope} is back on the all-agents model`;
        body.querySelector(".use").disabled = true;
        page.send({ type: "model_set", for: form.scope, provider, id: rest.join("/") || undefined });
      };
    }
    render();
  }

  // ---- what the server says
  page.on("login", (ev) => {
    if (!sheet.open) return;
    const err = sheet.querySelector(".error");
    if (ev.step === "error") {
      if (err) err.textContent = ev.text;
      sheet.querySelector(".save")?.removeAttribute("disabled");
      const msg = sheet.querySelector(".msg");
      if (view === "signin" && msg) { msg.textContent = "Didn't work:"; sheet.querySelector(".spin")?.remove(); }
      if (view === "custom") sheet.querySelector(".found").innerHTML = "";
      if (view === "model") { sheet.querySelector(".use")?.removeAttribute("disabled"); form.said = null; }
      return;
    }
    if (ev.step === "done") {
      page.note(`connected to ${ev.provider}`);
      return showModels(`Connected to ${ev.provider} ✓`);
    }
    if (ev.step === "cancelled" && view === "signin") return showList();
    if (ev.step === "models" && view === "custom") {
      form.found = ev.models;
      sheet.querySelector(".add").dispatchEvent(new Event("input"));
      if (!ev.models.length) sheet.querySelector(".found").innerHTML = `<span class="hint">The endpoint listed no models: type their names.</span>`;
      return;
    }
    if (ev.step === "changed" && view === "logout") return showLogout();
    if (ev.step === "changed" && view === "model" && form?.said) { page.note(form.said); return close(); }
    onSignIn(ev);
  });

  fetch("/login/on").then((r) => {  // CHALKY_LOGIN=off: the server has no /login, and the page no commands
    if (!r.ok) return;
    page.command("login", () => open(showList), "Connect a model: sign in with a subscription, or a custom endpoint");
    page.command("logout", () => open(showLogout), "Remove a saved login");
    page.command("model", () => open(() => showModels()), "Choose the model, for all agents or one");
  });
}
