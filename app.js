/* Garden path advertising study — single-page app, one screen at a time. */
(function () {
  "use strict";
  const C = window.GP_CONFIG;
  const app = document.getElementById("app");
  const progressEl = document.getElementById("progress");
  const params = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ state
  const S = {
    sessionId: null,
    offline: false,
    layoutId: null,
    colorMap: null,      // { GP: "blue", CA: "red", CB: "green" }
    pageOrder: null,     // ["CB","GP","CA"]  -> ad pages 1..3
    participantId: params.get("pid") || params.get("PROLIFIC_PID") || params.get("id") || "",
    station: params.get("station") || "",
    eyeTracker: params.get("et") === "1",
    isTest: params.get("test") === "1",
    ads: {},             // per sentence: dwell, visits, firstVisit, hover
    choice: null,
    recall: "",
    ratings: {},
    answers: {},
    phase: "consent",
    events: [], seq: 0
  };

  // ------------------------------------------------------------------ backend
  async function rpc(name, body, keepalive) {
    const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST", keepalive: !!keepalive,
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_KEY },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`${name} failed: ${r.status} ${await r.text()}`);
    return r.json();
  }

  function log(page, event, detail) {
    S.events.push({ seq: S.seq++, epoch: Date.now(), perf: Math.round(performance.now() * 10) / 10, page, event, detail: detail || null });
  }
  async function flush(keepalive) {
    if (!S.sessionId || S.offline || !S.events.length) return;
    const batch = S.events.splice(0, 400);
    try { await rpc("gp_log_events", { p_session: S.sessionId, p_events: batch }, keepalive); }
    catch (e) { S.events.unshift(...batch); console.warn(e); }
  }
  setInterval(() => flush(false), C.FLUSH_MS);
  document.addEventListener("visibilitychange", () => {
    log(S.phase, document.hidden ? "hidden" : "visible");
    if (document.hidden) flush(true);
    adTimer.visibility();
  });
  window.addEventListener("blur", () => { log(S.phase, "window_blur"); adTimer.visibility(); });
  window.addEventListener("focus", () => { log(S.phase, "window_focus"); adTimer.visibility(); });
  window.addEventListener("pagehide", () => flush(true));
  window.addEventListener("beforeunload", (e) => {
    if (S.phase !== "done" && S.phase !== "consent" && S.phase !== "blocked") { e.preventDefault(); e.returnValue = ""; }
  });

  // ------------------------------------------------------------------ helpers
  const h = (html) => { app.innerHTML = html; window.scrollTo(0, 0); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel) => app.querySelector(sel);
  const $$ = (sel) => Array.from(app.querySelectorAll(sel));
  const colorOf = (sid) => S.colorMap[sid];
  const posOf = (sid) => S.pageOrder.indexOf(sid) + 1;
  const radioVal = (name) => { const el = app.querySelector(`input[name="${name}"]:checked`); return el ? el.value : null; };
  function setProgress(t) { progressEl.textContent = t || ""; }

  function shirtSVG(colorKey, size) {
    const s = size || 320;
    return `<img src="${C.COLORS[colorKey].img}" width="${s}" height="${s}" alt="${C.COLORS[colorKey].label} t-shirt" draggable="false">`;
  }
  // Preload all three photos so image loading never eats into dwell time
  const preloaded = Object.values(C.COLORS).map((c) => { const im = new Image(); im.src = c.img; return im.decode ? im.decode().catch(() => {}) : Promise.resolve(); });

  function adStage(sid, labelText) {
    return `<div class="ad-stage" id="stage">
      ${labelText ? `<div class="ad-label">${esc(labelText)}</div>` : ""}
      <div class="ad-shirt" id="aoi-shirt">${shirtSVG(colorOf(sid))}</div>
      <div class="ad-slogan" id="aoi-text">${esc(C.SENTENCES[sid])}</div>
    </div>`;
  }

  function aoiRects() {
    const r = (id) => { const el = document.getElementById(id); if (!el) return null; const b = el.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { stage: r("stage"), shirt: r("aoi-shirt"), text: r("aoi-text"), scrollY: Math.round(scrollY), vw: innerWidth, vh: innerHeight };
  }

  // ------------------------------------------------------------------ ad dwell timer
  const adTimer = {
    current: null, start: null, visitStart: null, hoverStart: null,
    active() { return !document.hidden && document.hasFocus(); },
    enter(sid) {
      this.leave();
      const a = S.ads[sid];
      a.visits += 1;
      this.current = sid; this.visitStart = 0;
      this.start = this.active() ? performance.now() : null;
    },
    accumulate() {
      if (this.current && this.start != null) {
        const d = performance.now() - this.start;
        S.ads[this.current].dwell += d; this.visitStart += d;
        this.start = this.active() ? performance.now() : null;
      }
    },
    visibility() {
      if (!this.current) return;
      if (this.start != null && !this.active()) { this.accumulate(); this.start = null; this.hoverOut(); }
      else if (this.start == null && this.active()) { this.start = performance.now(); }
    },
    hoverIn() { if (this.current && this.hoverStart == null) this.hoverStart = performance.now(); },
    hoverOut() { if (this.current && this.hoverStart != null) { S.ads[this.current].hover += performance.now() - this.hoverStart; this.hoverStart = null; } },
    leave() {
      if (!this.current) return;
      this.hoverOut(); this.accumulate();
      const a = S.ads[this.current];
      if (a.visits === 1) a.firstVisit = this.visitStart;
      log("ad", "leave", { sentence: this.current, visit_ms: Math.round(this.visitStart), total_ms: Math.round(a.dwell) });
      this.current = null; this.start = null;
    },
    seen(sid) { const a = S.ads[sid]; const live = (this.current === sid && this.start != null) ? performance.now() - this.start : 0; return a.dwell + live >= C.MIN_VIEW_MS; }
  };

  // ------------------------------------------------------------------ screens
  function blocked(msg) {
    S.phase = "blocked"; setProgress("");
    h(`<div class="panel blocker"><h1>Please switch devices</h1><p>${msg}</p></div>`);
  }

  function screenConsent() {
    S.phase = "consent"; setProgress("");
    h(`<div class="panel">
      <h1>Consent to participate</h1>
      <p>You are invited to take part in a research study on how people read and evaluate advertisements, conducted by Dr. Mustafa Canbolat, SUNY Brockport.</p>
      <p>You will look at three short advertisements, choose the one you find most effective, and answer some questions. It takes about 10 minutes. ${S.eyeTracker ? "In this lab session your eye movements are recorded by the eye tracker." : ""} There are no known risks beyond those of everyday computer use. Participation is voluntary, and you may stop at any time without penalty. Your responses are stored without your name.</p>
      <p class="muted">[IRB approval number and contact information to be inserted here.]</p>
      ${S.participantId ? "" : `<div class="q"><div class="prompt">Participant ID (from the researcher or SONA)</div><input type="text" id="pid" maxlength="60" autocomplete="off"></div>`}
      <label><input type="checkbox" id="agree"> I am 18 or older, I have read the information above, and I agree to participate.</label>
      <div class="actions"><span class="spacer"></span><button class="primary" id="go" disabled>Continue</button></div>
    </div>`);
    $("#agree").addEventListener("change", (e) => { $("#go").disabled = !e.target.checked; });
    $("#go").addEventListener("click", async () => {
      if (!S.participantId && $("#pid")) S.participantId = $("#pid").value.trim();
      $("#go").disabled = true; $("#go").textContent = "Starting…";
      await startSession();
      screenInstructions();
    });
  }

  function randomLayout() {
    const perms = [["GP","CA","CB"],["GP","CB","CA"],["CA","GP","CB"],["CA","CB","GP"],["CB","GP","CA"],["CB","CA","GP"]];
    const id = Math.floor(Math.random() * 36), a = perms[Math.floor(id / 6)], o = perms[id % 6];
    return { layout_id: id, color_map: { [a[0]]: "red", [a[1]]: "blue", [a[2]]: "green" }, page_order: o };
  }

  async function startSession() {
    let res;
    try {
      res = await rpc("gp_start_session", {
        p_participant_id: S.participantId || null, p_station: S.station || null, p_eye_tracker: S.eyeTracker, p_is_test: S.isTest,
        p_user_agent: navigator.userAgent, p_screen_w: screen.width, p_screen_h: screen.height,
        p_viewport_w: innerWidth, p_viewport_h: innerHeight, p_dpr: devicePixelRatio
      });
      S.sessionId = res.session_id;
    } catch (e) {
      console.warn(e); S.offline = true; res = randomLayout();
    }
    S.layoutId = res.layout_id; S.colorMap = res.color_map; S.pageOrder = res.page_order;
    for (const sid of S.pageOrder) S.ads[sid] = { dwell: 0, visits: 0, firstVisit: null, hover: 0 };
    log("consent", "session_start", { layout_id: S.layoutId, color_map: S.colorMap, page_order: S.pageOrder, offline: S.offline });
  }

  function screenInstructions() {
    S.phase = "instructions"; setProgress("Instructions");
    log("instructions", "enter");
    h(`<div class="panel">
      <h1>Instructions</h1>
      <p>A clothing company has created <strong>three advertisements</strong> for its new line of t-shirts and can run only one of them.</p>
      <p><strong>Your task is to decide which advertisement is the most effective</strong>, that is, the one you think would make people most interested in the product.</p>
      <ul>
        <li>The three advertisements are shown on separate pages, one at a time.</li>
        <li>Use the <strong>Next</strong> and <strong>Back</strong> buttons, or the <strong>Ad 1 · Ad 2 · Ad 3</strong> tabs, to move between them. You can go back and forth as many times as you like.</li>
        <li>Look at each advertisement as you normally would. There is no time limit.</li>
        <li>When you are ready, continue to the choice page and pick one. You can still return to the ads from there before you confirm.</li>
      </ul>
      ${S.eyeTracker ? `<p class="muted">Please keep your head still and stay facing the screen while you view the advertisements.</p>` : ""}
      <div class="actions"><span class="spacer"></span><button class="primary" id="go">Show the first advertisement</button></div>
    </div>`);
    $("#go").addEventListener("click", async () => {
      if (document.documentElement.requestFullscreen && S.eyeTracker) document.documentElement.requestFullscreen().catch(() => {});
      $("#go").disabled = true;
      await Promise.all(preloaded);
      log("instructions", "leave"); screenAd(0);
    });
  }

  function screenAd(i) {
    S.phase = "ad"; const sid = S.pageOrder[i];
    setProgress("Viewing the advertisements");
    const allSeen = () => S.pageOrder.every((s) => adTimer.seen(s));
    h(`<nav class="ad-nav" aria-label="Advertisements">
        ${S.pageOrder.map((s, k) => `<button class="ad-tab ${k === i ? "current" : ""}" data-k="${k}">Ad ${k + 1}${S.ads[s].visits ? '<span class="seen">✓</span>' : ""}</button>`).join("")}
      </nav>
      ${adStage(sid, `Advertisement ${i + 1} of 3`)}
      <div class="actions" style="max-width:900px;margin-left:auto;margin-right:auto">
        <button id="back" ${i === 0 ? "disabled" : ""}>← Back</button>
        <span class="spacer"></span>
        ${i < 2 ? `<button class="primary" id="next">Next →</button>`
                : `<button class="primary" id="tochoice">Continue to choice →</button>`}
      </div>
      <p class="muted" id="hint" style="text-align:center;min-height:1.4em"></p>`);
    adTimer.enter(sid);
    log("ad", "enter", { page: i + 1, sentence: sid, color: colorOf(sid), visit: S.ads[sid].visits, aoi: aoiRects() });
    const t = $("#aoi-text");
    t.addEventListener("mouseenter", () => { adTimer.hoverIn(); log("ad", "text_hover_in", { sentence: sid }); });
    t.addEventListener("mouseleave", () => { adTimer.hoverOut(); log("ad", "text_hover_out", { sentence: sid }); });
    const go = (k, how) => { log("ad", "navigate", { from: i + 1, to: k + 1, how }); adTimer.leave(); screenAd(k); };
    $$(".ad-tab").forEach((b) => b.addEventListener("click", () => { const k = +b.dataset.k; if (k !== i) go(k, "tab"); }));
    if (i > 0) $("#back").addEventListener("click", () => go(i - 1, "back"));
    if (i < 2) $("#next").addEventListener("click", () => go(i + 1, "next"));
    else $("#tochoice").addEventListener("click", () => {
      if (!allSeen()) { $("#hint").textContent = "Please look at all three advertisements before continuing."; log("ad", "choice_blocked"); return; }
      log("ad", "navigate", { from: 3, to: "choice", how: "continue" }); adTimer.leave(); screenChoice();
    });
    flush(false);
  }

  function screenChoice() {
    S.phase = "choice"; setProgress("Your choice");
    log("choice", "enter");
    h(`<div class="panel">
      <h1>Which advertisement is the most effective?</h1>
      <p>Select one. If you want to look again, use <em>Review the ads</em>. You will not be able to return to the ads after you confirm.</p>
      <div class="choices">
        ${S.pageOrder.map((s, k) => `<div class="choice ${S.choice === s ? "selected" : ""}" data-s="${s}" tabindex="0" role="button" aria-label="Advertisement ${k + 1}">
          ${shirtSVG(colorOf(s), 160)}<div class="name">Advertisement ${k + 1}</div></div>`).join("")}
      </div>
      <div class="actions"><button id="review">← Review the ads</button><span class="spacer"></span><button class="primary" id="confirm" ${S.choice ? "" : "disabled"}>Confirm my choice</button></div>
    </div>`);
    $$(".choice").forEach((el) => {
      const pick = () => { S.choice = el.dataset.s; $$(".choice").forEach((c) => c.classList.toggle("selected", c === el)); $("#confirm").disabled = false;
        log("choice", "select", { sentence: S.choice, position: posOf(S.choice), color: colorOf(S.choice) }); };
      el.addEventListener("click", pick); el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    $("#review").addEventListener("click", () => { log("choice", "review"); screenAd(0); });
    $("#confirm").addEventListener("click", () => { log("choice", "confirm", { sentence: S.choice, position: posOf(S.choice), color: colorOf(S.choice) });
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      screenRecall(); });
  }

  function screenRecall() {
    S.phase = "recall"; setProgress("Memory");
    log("recall", "enter"); const t0 = performance.now();
    h(`<div class="panel">
      <h1>What do you remember?</h1>
      <p>Without looking back, please type the <strong>text (slogan)</strong> of each advertisement as closely as you can remember it, one per line. If you remember only part of a slogan, type the part you remember.</p>
      <textarea id="recall" spellcheck="false" autocomplete="off"></textarea>
      <div class="actions"><span class="spacer"></span><button class="primary" id="go">Continue</button></div>
    </div>`);
    $("#recall").addEventListener("paste", (e) => e.preventDefault());
    $("#go").addEventListener("click", () => { S.recall = $("#recall").value.trim(); S.answers.recall_ms = Math.round(performance.now() - t0);
      log("recall", "leave", { chars: S.recall.length }); screenRatings(); });
  }

  function scale(name, n, lo, hi) {
    let out = `<div class="scale" role="radiogroup"><span class="anchor">${lo}</span>`;
    for (let k = 1; k <= n; k++) out += `<label><input type="radio" name="${name}" value="${k}">${k}</label>`;
    return out + `<span class="anchor">${hi}</span></div>`;
  }

  function screenRatings() {
    S.phase = "ratings"; setProgress("Ratings");
    log("ratings", "enter");
    h(`<div class="panel">
      <h1>Please rate each advertisement</h1>
      ${S.pageOrder.map((s, k) => `<div class="rating-block">
        <h2>Advertisement ${k + 1}</h2>
        <div class="small-stage">${adStage(s)}</div>
        <div class="q"><div class="prompt">How effective is this advertisement?</div>${scale(`eff_${s}`, 10, "Not at all effective", "Extremely effective")}</div>
        <div class="q"><div class="prompt">How easy was the text of this advertisement to understand?</div>${scale(`clar_${s}`, 7, "Very difficult", "Very easy")}</div>
        <div class="q"><div class="prompt">Does the text of this advertisement contain a grammatical error?</div>
          <div class="opts"><label><input type="radio" name="err_${s}" value="yes"> Yes</label><label><input type="radio" name="err_${s}" value="no"> No</label><label><input type="radio" name="err_${s}" value="unsure"> Not sure</label></div></div>
        <div class="q"><div class="prompt">How much do you like the color of this shirt?</div>${scale(`col_${s}`, 7, "Dislike very much", "Like very much")}</div>
      </div>`).join("")}
      <p class="error" id="err"></p>
      <div class="actions"><span class="spacer"></span><button class="primary" id="go">Continue</button></div>
    </div>`);
    // Rescale stage IDs so they don't collide (several stages on this page)
    $$(".small-stage .ad-stage").forEach((el, k) => { el.id = "stage_r" + k; el.querySelector("#aoi-shirt").id = ""; el.querySelector("#aoi-text").id = ""; });
    $("#go").addEventListener("click", () => {
      const missing = [];
      for (const s of S.pageOrder) {
        const r = { eff: radioVal(`eff_${s}`), clar: radioVal(`clar_${s}`), err: radioVal(`err_${s}`), col: radioVal(`col_${s}`) };
        if (Object.values(r).some((v) => v == null)) missing.push(posOf(s));
        S.ratings[s] = r;
      }
      if (missing.length) { $("#err").textContent = `Please answer every question for advertisement ${missing.join(", ")}.`; return; }
      log("ratings", "leave", S.ratings); screenQuestions();
    });
  }

  function screenQuestions() {
    S.phase = "questions"; setProgress("A few last questions");
    log("questions", "enter");
    const opts = (name, list) => `<div class="opts">${list.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}"> ${l}</label>`).join("")}</div>`;
    h(`<div class="panel">
      <h1>A few last questions</h1>
      <div class="q"><div class="prompt">According to the advertisements, where is the cotton grown?</div>
        ${opts("comp", [["georgia","Georgia"],["mississippi","Mississippi"],["texas","Texas"],["not_stated","The advertisements did not say"]])}</div>
      <div class="q"><div class="prompt">Before today, had you ever seen this sentence: <em>“${esc(C.SENTENCES.GP)}”</em> (for example, in a class or online)?</div>
        ${opts("seen_before", [["yes","Yes"],["no","No"],["unsure","Not sure"]])}</div>
      <div class="q"><div class="prompt">In a few words, why did you choose the advertisement you chose? <span class="muted">(optional)</span></div>
        <textarea id="why" style="min-height:70px"></textarea></div>
      <div class="q"><div class="prompt">Age</div><input type="number" id="age" min="18" max="99" style="width:100px"></div>
      <div class="q"><div class="prompt">Gender</div>${opts("gender", [["woman","Woman"],["man","Man"],["nonbinary","Non-binary"],["self","Prefer to self-describe"],["na","Prefer not to say"]])}</div>
      <div class="q"><div class="prompt">Is English your first language?</div>${opts("l1_english", [["yes","Yes"],["no","No"]])}</div>
      <div class="q"><div class="prompt">Do you have any form of color blindness or color vision deficiency?</div>${opts("colorblind", [["no","No"],["yes","Yes"],["unsure","Not sure"]])}</div>
      <div class="q"><div class="prompt">Are you wearing glasses or contact lenses right now?</div>${opts("correction", [["none","Neither"],["glasses","Glasses"],["contacts","Contact lenses"]])}</div>
      <div class="q"><div class="prompt">Have you taken a course in linguistics, psycholinguistics, or psychology of language?</div>${opts("ling_course", [["yes","Yes"],["no","No"]])}</div>
      <p class="error" id="err"></p>
      <div class="actions"><span class="spacer"></span><button class="primary" id="go">Submit</button></div>
    </div>`);
    $("#go").addEventListener("click", async () => {
      const a = {
        comprehension: radioVal("comp"), seen_before: radioVal("seen_before"), why: $("#why").value.trim(),
        age: $("#age").value ? +$("#age").value : null, gender: radioVal("gender"), l1_english: radioVal("l1_english"),
        colorblind: radioVal("colorblind"), correction: radioVal("correction"), ling_course: radioVal("ling_course")
      };
      const req = ["comprehension", "seen_before", "age", "gender", "l1_english", "colorblind", "correction", "ling_course"];
      if (req.some((k) => a[k] == null)) { $("#err").textContent = "Please answer every question (only the last text box is optional)."; return; }
      Object.assign(S.answers, a);
      $("#go").disabled = true; $("#go").textContent = "Submitting…";
      log("questions", "submit");
      await finish();
    });
  }

  function payload() {
    return {
      choice_sentence: S.choice, choice_color: colorOf(S.choice), choice_position: posOf(S.choice),
      recall_text: S.recall,
      answers: Object.assign({ layout_id: S.layoutId, color_map: S.colorMap, page_order: S.pageOrder, participant_id: S.participantId, offline: S.offline }, S.answers),
      ads: S.pageOrder.map((s) => ({
        sentence_id: s, color: colorOf(s), position: posOf(s),
        dwell_ms: Math.round(S.ads[s].dwell), visits: S.ads[s].visits, first_visit_ms: Math.round(S.ads[s].firstVisit || 0),
        text_hover_ms: Math.round(S.ads[s].hover),
        rating_effective: +S.ratings[s].eff, rating_clarity: +S.ratings[s].clar, error_judgment: S.ratings[s].err, color_liking: +S.ratings[s].col
      }))
    };
  }

  async function finish() {
    const p = payload();
    let ok = false;
    if (!S.offline) {
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try { await flush(false); await rpc("gp_finish_session", { p_session: S.sessionId, p_payload: p }); ok = true; }
        catch (e) { console.warn(e); await new Promise((r) => setTimeout(r, 1200)); }
      }
    }
    screenDone(ok, p);
  }

  function screenDone(ok, p) {
    S.phase = "done"; setProgress("");
    const code = "GP-" + (S.sessionId ? S.sessionId.slice(0, 6).toUpperCase() : Math.random().toString(36).slice(2, 8).toUpperCase());
    h(`<div class="panel">
      <h1>Thank you!</h1>
      <p>Your responses have been ${ok ? "recorded" : "saved on this computer"}. Your completion code is:</p>
      <p><span class="code">${code}</span></p>
      <p>The purpose of this study is to examine whether advertising slogans that are temporarily hard to read (such as “The cotton clothing is made of grows in Mississippi,” meaning <em>the cotton that clothing is made of grows in Mississippi</em>) hold readers’ attention longer and are judged differently from simpler slogans. Please do not discuss the slogans with others who may take part.</p>
      ${ok ? `<p class="muted">You may now close this window.</p>` :
        `<p class="error">We could not reach the database. Please tell the researcher; do not close this window.</p>
         <button id="dl">Download data file (researcher)</button>`}
    </div>`);
    if (!ok) $("#dl").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ session_id: S.sessionId, payload: p, events: S.events }, null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `gardenpath_${code}.json`; a.click();
    });
  }

  // ------------------------------------------------------------------ boot
  const chromeLike = /Chrome\//.test(navigator.userAgent) && !/Mobile|Android|iPhone|iPad/.test(navigator.userAgent);
  if (innerWidth < 960 || /Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) {
    blocked("This study must be completed on a desktop or laptop computer with a window at least 960 pixels wide. Please reopen the link on a computer in Google Chrome.");
  } else {
    if (!chromeLike && !S.isTest) progressEl.textContent = "Tip: this study is designed for Google Chrome.";
    screenConsent();
  }
  // Expose for debugging in test mode only
  if (S.isTest) window.__GP = S;
})();
