(function () {
  const Q = window.QuantumGomoku;
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const bannerEl = document.getElementById("banner");
  const whoEl = document.getElementById("who");
  const previewEl = document.getElementById("preview");
  const queueEl = document.getElementById("queue");
  const eyesEl = document.getElementById("eyes");
  const oddsEl = document.getElementById("odds");
  const logEl = document.getElementById("log");
  const observeBtn = document.getElementById("observe");
  const passBtn = document.getElementById("pass");
  const undoBtn = document.getElementById("undo");
  const restartBtn = document.getElementById("restart");
  const modeEl = document.getElementById("mode");
  const humanEl = document.getElementById("human");
  const colorField = document.getElementById("color-field");
  const winEl = document.getElementById("win");
  const sizeEl = document.getElementById("size");
  const soundEl = document.getElementById("sound");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let game = null;
  let epoch = 0;
  let cpuTimer = 0;
  let animTimer = 0;
  let revealing = false;
  let skipReveal = false;
  let reveal = null;
  let hover = null;
  let cachedEstimate = null;
  let selectedOwn = 90;
  let repeat70 = false;
  let audioCtx = null;

  function settings() {
    return {
      mode: modeEl.value,
      human: Number(humanEl.value),
      win: Number(winEl.value),
      size: Number(sizeEl.value),
    };
  }

  function cpuPlayer() {
    return Q.opponent(settings().human);
  }

  function humanControls() {
    if (!game || game.winner || revealing) return false;
    if (settings().mode === "pvp") return true;
    return game.turn === settings().human;
  }

  function cpuShouldMove() {
    if (!game || game.winner || revealing) return false;
    if (settings().mode !== "cpu") return false;
    return game.turn === cpuPlayer() && (game.phase === "place" || game.phase === "decide");
  }

  function stopMotion() {
    epoch += 1;
    clearTimeout(cpuTimer);
    clearTimeout(animTimer);
    revealing = false;
    skipReveal = false;
    reveal = null;
  }

  function scheduleCpu(delay) {
    clearTimeout(cpuTimer);
    const token = epoch;
    if (!cpuShouldMove()) return;
    cpuTimer = setTimeout(() => cpuStep(token), delay);
  }

  function canRepeat70() {
    if (!game || game.winner || game.phase !== "place") return false;
    return game.lastOwnPercent(game.turn) === 70 && game.legalOwnPercents(game.turn).includes(90);
  }

  function syncSelection() {
    if (!game || game.winner || game.phase !== "place") return;
    if (!canRepeat70()) repeat70 = false;
    const legal = game.legalOwnPercents(game.turn);
    selectedOwn = !legal.includes(90) || repeat70 ? 70 : 90;
  }

  function tone(freq, dur, type, gain) {
    if (!soundEl.checked) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain || 0.045, t + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function refreshEstimate() {
    if (game.phase === "decide" && (game.observations[game.turn] > 0 || game.isFull())) {
      cachedEstimate = Q.estimate(game, 360);
    } else {
      cachedEstimate = null;
    }
  }

  function restart() {
    stopMotion();
    const pref = settings();
    game = Q.createGame({ size: pref.size, winLength: pref.win });
    selectedOwn = 90;
    repeat70 = false;
    cachedEstimate = null;
    hover = null;
    colorField.hidden = pref.mode === "pvp";
    resize();
    render();
    scheduleCpu(pref.human === Q.WHITE ? 500 : 0);
  }

  function cpuStep(token) {
    if (token !== epoch || !cpuShouldMove()) return;
    if (game.phase === "place") {
      const move = Q.chooseAiMove(game);
      if (!move) return;
      game.place(move.r, move.c, move.ownPercent);
      tone(520, 0.07, "sine", 0.04);
      refreshEstimate();
      render();
      scheduleCpu(520);
      return;
    }
    if (game.isFull() || Q.aiWantsObserve(game)) {
      const result = game.observe();
      tone(640, 0.12, "sine", 0.05);
      playReveal(result, token);
      return;
    }
    game.pass();
    tone(300, 0.06, "triangle", 0.03);
    cachedEstimate = null;
    render();
  }

  function ramp(from, to, ms, token) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      function frame(now) {
        if (token !== epoch) {
          resolve();
          return;
        }
        const p = skipReveal ? 1 : Math.min(1, (now - t0) / ms);
        if (reveal) reveal.alpha = from + (to - from) * p;
        draw();
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function hold(ms, token) {
    return new Promise((resolve) => {
      const start = performance.now();
      function tick() {
        if (token !== epoch || skipReveal || performance.now() - start >= ms) {
          resolve();
          return;
        }
        animTimer = setTimeout(tick, 40);
      }
      tick();
    });
  }

  async function playReveal(result, token) {
    revealing = true;
    skipReveal = false;
    reveal = {
      rolled: result.rolled,
      lines: result.winner && result.winner !== "draw" ? result.lines : [],
      alpha: 0,
    };
    render();
    await ramp(0, 1, reduced ? 40 : 640, token);
    if (token !== epoch) return;
    if (reveal) reveal.alpha = 1;
    render();
    if (!skipReveal) await hold(result.winner ? (reduced ? 200 : 900) : reduced ? 200 : 1500, token);
    if (token !== epoch) return;
    if (result.reverted && !skipReveal) await ramp(1, 0, reduced ? 40 : 360, token);
    if (token !== epoch) return;
    reveal = null;
    revealing = false;
    skipReveal = false;
    if (result.winner) tone(result.winner === "draw" ? 220 : 784, 0.18, "sine", 0.05);
    else tone(196, 0.16, "triangle", 0.04);
    render();
    if (cpuShouldMove()) scheduleCpu(360);
  }

  function onPointer(event) {
    const cell = cellFromEvent(event);
    if (!cell) {
      if (hover) {
        hover = null;
        draw();
      }
      return;
    }
    if (hover && hover.r === cell.r && hover.c === cell.c) return;
    hover = cell;
    draw();
  }

  function onClick(event) {
    if (revealing) {
      skipReveal = true;
      return;
    }
    if (!humanControls() || game.phase !== "place") return;
    const cell = cellFromEvent(event);
    if (!cell || game.stoneAt(cell.r, cell.c)) return;
    const result = game.place(cell.r, cell.c, selectedOwn);
    if (!result.ok) return;
    repeat70 = false;
    tone(540, 0.08, "sine", 0.045);
    refreshEstimate();
    render();
    if (result.autoPassed) scheduleCpu(420);
  }

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const m = metrics();
    const c = Math.round((x - m.pad) / m.cell);
    const r = Math.round((y - m.pad) / m.cell);
    if (!game.inBounds(r, c)) return null;
    const [sx, sy] = xy(r, c, m);
    if (Math.hypot(sx - x, sy - y) > m.cell * 0.48) return null;
    return { r, c };
  }

  function metrics() {
    const css = canvas.clientWidth || 720;
    const pad = Math.max(28, css * 0.055);
    const cell = (css - pad * 2) / (game.size - 1);
    return { css, pad, cell };
  }

  function xy(r, c, m) {
    return [m.pad + c * m.cell, m.pad + r * m.cell];
  }

  function resize() {
    const css = canvas.clientWidth || 720;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (game) draw();
  }

  function stars(size) {
    if (size === 9) return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
    if (size === 15) {
      const p = [3, 7, 11];
      return p.flatMap((r) => p.map((c) => [r, c]));
    }
    return [];
  }

  function draw() {
    const m = metrics();
    ctx.clearRect(0, 0, m.css, m.css);
    const wood = ctx.createLinearGradient(0, 0, m.css, m.css);
    wood.addColorStop(0, "#f2d7a4");
    wood.addColorStop(0.5, "#e8c17a");
    wood.addColorStop(1, "#d7a85a");
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, m.css, m.css);
    ctx.save();
    ctx.globalAlpha = 0.05;
    for (let y = 0; y < m.css; y += 4) {
      ctx.fillStyle = y % 8 === 0 ? "#6a4518" : "#fff6e4";
      ctx.fillRect(0, y, m.css, 1);
    }
    ctx.restore();

    ctx.strokeStyle = "#3c2918";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < game.size; i += 1) {
      const [x0, y] = xy(i, 0, m);
      const [x1] = xy(i, game.size - 1, m);
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      const [x, y0] = xy(0, i, m);
      const [, y1] = xy(game.size - 1, i, m);
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    ctx.stroke();

    ctx.fillStyle = "#3c2918";
    for (const [r, c] of stars(game.size)) {
      const [x, y] = xy(r, c, m);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, m.cell * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#5a4634";
    ctx.font = `${Math.max(10, m.cell * 0.28)}px "Hiragino Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < game.size; i += 1) {
      const [x] = xy(0, i, m);
      ctx.fillText(String.fromCharCode(65 + i), x, m.pad * 0.42);
      const [, y] = xy(i, 0, m);
      ctx.fillText(String(i + 1), m.pad * 0.38, y);
    }

    const lines = reveal ? reveal.lines : game.lines;
    for (const stone of game.stones) drawStone(stone, m);
    if (hover && game.phase === "place" && humanControls() && !game.stoneAt(hover.r, hover.c)) {
      const spec = game.stoneSpec(game.turn, selectedOwn);
      drawQuantum(hover.r, hover.c, spec.pBlack, game.turn, m, 0.45, spec.ownPercent);
    }
    drawWinLines(lines, m);
  }

  function shownColor(stone) {
    if (reveal) {
      const hit = reveal.rolled.find((item) => item.r === stone.r && item.c === stone.c);
      return { color: hit ? hit.color : 0, alpha: reveal.alpha };
    }
    if (game.collapsed) return { color: game.collapsed[stone.r][stone.c], alpha: 1 };
    return { color: 0, alpha: 0 };
  }

  function drawStone(stone, m) {
    const shown = shownColor(stone);
    const color = shown.color;
    const alpha = shown.alpha;
    if (alpha < 0.98) drawQuantum(stone.r, stone.c, stone.pBlack, stone.owner, m, 1 - alpha * 0.85, stone.ownPercent);
    if (color && alpha > 0.02) drawSolid(stone.r, stone.c, color, m, alpha);
  }

  function drawQuantum(r, c, pBlack, owner, m, alpha, label) {
    const [x, y] = xy(r, c, m);
    const rad = m.cell * 0.4;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#f7f1e6";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pBlack / 100));
    ctx.closePath();
    ctx.fillStyle = "#1b1b1b";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.strokeStyle = owner === Q.BLACK ? "#1b1b1b" : "#fffaf3";
    ctx.lineWidth = Math.max(1.5, rad * 0.08);
    ctx.stroke();
    if (rad >= 11) {
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.48, 0, Math.PI * 2);
      ctx.fillStyle = "#141210";
      ctx.fill();
      ctx.fillStyle = "#f6f1e7";
      ctx.font = `700 ${Math.max(9, rad * 0.42)}px "Hiragino Sans", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(label == null ? pBlack : label), x, y + 0.5);
    }
    ctx.restore();
  }

  function drawSolid(r, c, color, m, alpha) {
    const [x, y] = xy(r, c, m);
    const rad = m.cell * 0.42;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x + rad * 0.08, y + rad * 0.12, rad, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(40, 24, 10, 0.28)";
    ctx.fill();
    const grad = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.15, x, y, rad);
    if (color === Q.BLACK) {
      grad.addColorStop(0, "#6a6a6a");
      grad.addColorStop(0.55, "#242424");
      grad.addColorStop(1, "#070707");
    } else {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.55, "#f3f3f3");
      grad.addColorStop(1, "#cfcfcf");
    }
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function drawWinLines(lines, m) {
    if (!lines || !lines.length) return;
    ctx.save();
    ctx.strokeStyle = "rgba(196, 69, 54, 0.92)";
    ctx.lineWidth = Math.max(3, m.cell * 0.09);
    ctx.lineCap = "round";
    for (const line of lines) {
      ctx.beginPath();
      line.cells.forEach((cell, index) => {
        const [x, y] = xy(cell.r, cell.c, m);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    syncSelection();
    colorField.hidden = settings().mode === "pvp";
    const spec = currentSpec();
    whoEl.textContent = whoText();
    statusEl.textContent = statusText();
    paintPreview(spec);
    paintQueue();
    paintEyes();
    paintOdds();
    paintLog();
    paintBanner();
    const mine = humanControls();
    const deciding = game.phase === "decide" && mine;
    observeBtn.disabled = revealing || !deciding;
    passBtn.disabled = revealing || !deciding || game.isFull();
    undoBtn.disabled = revealing || game.history.length === 0;
    observeBtn.textContent = game.isFull() ? "終局を観測する" : "観測する";
    canvas.style.cursor = game.phase === "place" && mine && !revealing ? "pointer" : "default";
    draw();
  }

  function currentSpec() {
    if (game.stones.length && (revealing || game.phase !== "place")) {
      const stone = game.stones[game.stones.length - 1];
      return {
        ...game.stoneSpec(stone.owner, stone.ownPercent),
        player: stone.owner,
        caption: revealing ? "観測した石" : "いま置いた石",
      };
    }
    const next = game.stoneSpec(game.turn, selectedOwn);
    return { ...next, player: game.turn, caption: "次に置く石" };
  }

  function whoText() {
    if (game.winner === "draw") return "引き分け";
    if (game.winner) return `${Q.playerName(game.winner)}の勝ち`;
    if (revealing) return "観測中";
    return `${Q.playerName(game.turn)}の番`;
  }

  function statusText() {
    const length = game.winLength;
    if (game.winner === "draw") return "盤が埋まり、終局の観測でも列は揃いませんでした。";
    if (game.winner && game.reason === "both") {
      return `両方の色が${length}つ以上揃いました。観測した${Q.playerName(game.winner)}の勝ちです。`;
    }
    if (game.winner) return `${Q.playerName(game.winner)}が${length}つ以上並びました。`;
    if (revealing && reveal && reveal.alpha > 0.8 && !game.winner) {
      return "揃いませんでした。盤をクリックすると、すぐに確率の石へ戻します。";
    }
    if (revealing) return "石の色を観測しています。";
    if (settings().mode === "cpu" && game.turn === cpuPlayer()) return "コンピュータが考えています。";
    if (game.phase === "decide") {
      if (game.isFull()) return "盤が埋まりました。終局の観測をします。";
      return `観測しますか。${Q.playerName(game.turn)}はあと${game.observations[game.turn]}回です。`;
    }
    const spec = game.stoneSpec(game.turn, selectedOwn);
    const who = Q.playerName(game.turn);
    let limit = "";
    if (!game.legalOwnPercents().includes(90)) limit = "直前が90%なので、今回は70%です。";
    else if (repeat70) limit = "70%を連続で置きます。";
    const place = `${who}の番です。${spec.focus}${spec.ownPercent}%の石を置く交点を選んでください。${limit}`;
    if (game.observations[game.turn] <= 0) return `${who}の観測は残っていません。${place}`;
    return place;
  }

  function paintPreview(spec) {
    previewEl.replaceChildren();
    const pie = document.createElement("div");
    pie.className = "pie";
    pie.style.setProperty("--p", String(spec.pBlack));
    const num = document.createElement("span");
    num.textContent = String(spec.ownPercent);
    pie.appendChild(num);
    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = spec.caption;
    const line = document.createElement("p");
    line.className = "hint";
    line.textContent = `${Q.playerName(spec.player)} · ${spec.focus}${spec.ownPercent}%`;
    const note = document.createElement("p");
    note.textContent = `黒${spec.pBlack}% / 白${spec.pWhite}%`;
    copy.append(title, line, note);
    previewEl.append(pie, copy);
  }

  function paintQueue() {
    queueEl.replaceChildren();
    if (!canRepeat70() || !humanControls()) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "repeat70" + (repeat70 ? " current" : "");
    button.textContent = repeat70 ? "90%に戻す" : "70%を連続で置く";
    button.addEventListener("click", () => {
      repeat70 = !repeat70;
      render();
    });
    queueEl.appendChild(button);
  }

  function paintEyes() {
    eyesEl.replaceChildren();
    for (const player of [Q.WHITE, Q.BLACK]) {
      const row = document.createElement("span");
      row.className = "eye-row";
      const name = document.createElement("span");
      name.textContent = Q.playerName(player);
      row.appendChild(name);
      const left = game.observations[player];
      for (let i = 0; i < 5; i += 1) {
        const dot = document.createElement("i");
        if (i < left) dot.className = "on";
        row.appendChild(dot);
      }
      eyesEl.appendChild(row);
    }
  }

  function paintOdds() {
    if (!cachedEstimate || game.phase !== "decide" || revealing) {
      oddsEl.hidden = true;
      oddsEl.replaceChildren();
      return;
    }
    oddsEl.hidden = false;
    const est = cachedEstimate;
    const pct = (value) => `${Math.round(value * 100)}%`;
    oddsEl.replaceChildren();
    const title = document.createElement("p");
    title.textContent = `${Q.playerName(est.observer)}が観測した場合の見込み（${est.samples}回）`;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.append(
      segment("black", est.blackOnly),
      segment("white", est.whiteOnly),
      segment("both", est.both),
      segment("none", est.none)
    );
    const list = document.createElement("ul");
    [
      `黒だけ ${pct(est.blackOnly)}`,
      `白だけ ${pct(est.whiteOnly)}`,
      `両方（観測した側の勝ち） ${pct(est.both)}`,
      `揃わず ${pct(est.none)}`,
    ].forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.appendChild(item);
    });
    oddsEl.append(title, bar, list);
  }

  function segment(name, value) {
    const span = document.createElement("span");
    span.className = name;
    span.style.width = `${Math.max(0, value * 100)}%`;
    return span;
  }

  function paintLog() {
    logEl.replaceChildren();
    game.log.slice(-16).reverse().forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      logEl.appendChild(item);
    });
  }

  function paintBanner() {
    if (!game.winner) {
      bannerEl.classList.add("hidden");
      bannerEl.textContent = "";
      return;
    }
    bannerEl.classList.remove("hidden");
    if (game.winner === "draw") bannerEl.textContent = "引き分け";
    else if (game.reason === "both") bannerEl.textContent = `観測した${Q.playerName(game.winner)}の勝ち`;
    else bannerEl.textContent = `${Q.playerName(game.winner)}の勝ち`;
  }

  observeBtn.addEventListener("click", () => {
    if (!humanControls() || game.phase !== "decide") return;
    const result = game.observe();
    if (!result.ok) return;
    cachedEstimate = null;
    tone(660, 0.12, "sine", 0.05);
    playReveal(result, epoch);
  });

  passBtn.addEventListener("click", () => {
    if (!humanControls() || game.phase !== "decide") return;
    const result = game.pass();
    if (!result.ok) return;
    cachedEstimate = null;
    tone(300, 0.06, "triangle", 0.03);
    render();
    scheduleCpu(420);
  });

  undoBtn.addEventListener("click", () => {
    if (revealing || game.history.length === 0) return;
    stopMotion();
    game.undo();
    if (settings().mode === "cpu") {
      while (game.turn === cpuPlayer() && game.history.length) game.undo();
    }
    refreshEstimate();
    render();
    scheduleCpu(300);
  });

  restartBtn.addEventListener("click", restart);
  for (const el of [modeEl, humanEl, winEl, sizeEl]) el.addEventListener("change", restart);

  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    if (game) draw();
  });
  canvas.addEventListener("click", onClick);
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);

  restart();
})();
