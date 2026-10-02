(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuantumGomoku = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BLACK = 1;
  const WHITE = 2;
  // プレイヤー1（白・先手）は白90%か白70%。プレイヤー2（黒）はその逆。
  // 90%の石は、同じプレイヤーが連続では置けない。
  const STRENGTHS = [90, 70];
  const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  function opponent(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  function playerName(player) {
    return player === BLACK ? "黒" : "白";
  }

  function coord(r, c) {
    return String.fromCharCode(65 + c) + (r + 1);
  }

  function key(r, c) {
    return r + "," + c;
  }

  function createGame(options = {}) {
    const size = options.size ?? 9;
    const winLength = options.winLength ?? 5;
if (size < 3 || size > 15) throw new Error("盤の大きさは3から15です");
    if (winLength < 3 || winLength > 15) throw new Error("勝ちの長さが盤に合いません");

    const game = {
      size,
      winLength,
      random: options.random || Math.random,
      turn: WHITE,
      phase: "place",
      winner: null,
      reason: null,
      observationsLeft: 5,
      stones: [],
      collapsed: null,
      lines: [],
      log: [],
      history: [],

      inBounds(r, c) {
        return r >= 0 && c >= 0 && r < this.size && c < this.size;
      },

      isFull() {
        return this.stones.length >= this.size * this.size;
      },

      stoneAt(r, c) {
        return this.stones.find((s) => s.r === r && s.c === c) || null;
      },

      focusName(player) {
        return player === WHITE ? "白" : "黒";
      },

      pBlackFor(player, ownPercent) {
        return player === WHITE ? 100 - ownPercent : ownPercent;
      },

      stoneSpec(player, ownPercent) {
        const pBlack = this.pBlackFor(player, ownPercent);
        return {
          ownPercent,
          pBlack,
          pWhite: 100 - pBlack,
          focus: this.focusName(player),
        };
      },

      lastOwnPercent(player) {
        for (let i = this.stones.length - 1; i >= 0; i -= 1) {
          if (this.stones[i].owner === player) return this.stones[i].ownPercent;
        }
        return null;
      },

      legalOwnPercents(player = this.turn) {
        if (this.lastOwnPercent(player) === 90) return [70];
        return STRENGTHS.slice();
      },

      nextStone(player = this.turn) {
        const ownPercent = this.legalOwnPercents(player)[0];
        return this.stoneSpec(player, ownPercent);
      },

      _snap() {
        return JSON.stringify({
          turn: this.turn,
          phase: this.phase,
          winner: this.winner,
          reason: this.reason,
          observationsLeft: this.observationsLeft,
          stones: this.stones.map((s) => ({ ...s })),
          collapsed: this.collapsed ? this.collapsed.map((row) => row.slice()) : null,
          lines: this.lines.map((line) => ({
            player: line.player,
            cells: line.cells.map((cell) => ({ ...cell })),
          })),
          log: this.log.slice(),
        });
      },

      _restore(raw) {
        const data = JSON.parse(raw);
        this.turn = data.turn;
        this.phase = data.phase;
        this.winner = data.winner;
        this.reason = data.reason;
        this.observationsLeft = data.observationsLeft;
        this.stones = data.stones;
        this.collapsed = data.collapsed;
        this.lines = data.lines;
        this.log = data.log;
      },

      undo() {
        if (!this.history.length) return false;
        this._restore(this.history.pop());
        return true;
      },

      place(r, c, ownPercent) {
        if (this.winner) return { ok: false, reason: "対局は終わっています" };
        if (this.phase !== "place") return { ok: false, reason: "観測するか渡すかを選んでください" };
        if (!this.inBounds(r, c)) return { ok: false, reason: "盤の外です" };
        if (this.stoneAt(r, c)) return { ok: false, reason: "そこにはすでに石があります" };
        const legal = this.legalOwnPercents(this.turn);
        const strength = ownPercent == null ? legal[0] : ownPercent;
        if (!legal.includes(strength)) {
          return { ok: false, reason: "90%の石は連続では置けません" };
        }

        this.history.push(this._snap());
        const spec = this.stoneSpec(this.turn, strength);
        const who = playerName(this.turn);
        this.stones.push({
          r,
          c,
          pBlack: spec.pBlack,
          ownPercent: spec.ownPercent,
          owner: this.turn,
        });
        this.log.push(`${who}が ${coord(r, c)} に${spec.focus}${spec.ownPercent}%を置いた`);
        this.phase = "decide";

        if (this.observationsLeft <= 0 && !this.isFull()) {
          this.log.push("観測は残っていないので、手番を渡した");
          this.turn = opponent(this.turn);
          this.phase = "place";
          return { ok: true, autoPassed: true };
        }
        return { ok: true, mustObserve: this.isFull() };
      },

      pass() {
        if (this.phase !== "decide") return { ok: false, reason: "今は手番を渡せません" };
        if (this.isFull()) return { ok: false, reason: "盤が埋まったので観測します" };
        this.history.push(this._snap());
        this.log.push(`${playerName(this.turn)}は観測しなかった`);
        this.turn = opponent(this.turn);
        this.phase = "place";
        return { ok: true };
      },

      observe() {
        if (this.phase !== "decide") return { ok: false, reason: "石を置いてから観測できます" };
        const terminal = this.isFull();
        if (this.observationsLeft <= 0 && !terminal) {
          return { ok: false, reason: "観測回数を使い切りました" };
        }

        this.history.push(this._snap());
        const spent = this.observationsLeft > 0;
        if (spent) this.observationsLeft -= 1;

        const observer = this.turn;
        const rolled = rollStones(this.stones, this.random);
        const grid = gridFromRoll(rolled, this.size);
        const judged = judgeGrid(grid, this.size, this.winLength, observer);
        const who = playerName(observer);

        if (judged.winner) {
          this.winner = judged.winner;
          this.reason = judged.reason;
          this.phase = "over";
          this.collapsed = grid;
          this.lines = judged.lines;
          this.log.push(winLog(who, judged));
        } else if (terminal) {
          this.winner = "draw";
          this.reason = "draw";
          this.phase = "over";
          this.collapsed = grid;
          this.lines = [];
          this.log.push(`終局の観測でも${this.winLength}つは揃わなかった`);
        } else {
          this.turn = opponent(observer);
          this.phase = "place";
          this.collapsed = null;
          this.lines = [];
          this.log.push(`${who}が観測したが揃わなかった（残り${this.observationsLeft}）`);
        }

        return {
          ok: true,
          winner: this.winner,
          reason: judged.winner ? judged.reason : terminal ? "draw" : "continue",
          observer,
          rolled,
          lines: judged.lines,
          reverted: !judged.winner && !terminal,
          observationsLeft: this.observationsLeft,
        };
      },
    };

    return game;
  }

  function winLog(who, judged) {
    const winner = playerName(judged.winner);
    if (judged.reason === "both") return `両方揃った。観測した${who}の勝ち`;
    if (judged.winner === BLACK || judged.winner === WHITE) {
      if (winner === who) return `${who}が観測し、${winner}の勝ち`;
      return `${who}が観測し、${winner}の列が揃った。${winner}の勝ち`;
    }
    return `${winner}の勝ち`;
  }

  function rollStones(stones, rng) {
    return stones.map((stone) => ({
      r: stone.r,
      c: stone.c,
      pBlack: stone.pBlack,
      owner: stone.owner,
      color: rng() < stone.pBlack / 100 ? BLACK : WHITE,
    }));
  }

  function gridFromRoll(rolled, size) {
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    for (const stone of rolled) grid[stone.r][stone.c] = stone.color;
    return grid;
  }

  function findLines(grid, size, winLength, player) {
    const lines = [];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (grid[r][c] !== player) continue;
        for (const [dr, dc] of DIRS) {
          const pr = r - dr;
          const pc = c - dc;
          if (pr >= 0 && pc >= 0 && pr < size && pc < size && grid[pr][pc] === player) continue;
          const cells = [];
          let rr = r;
          let cc = c;
          while (rr >= 0 && cc >= 0 && rr < size && cc < size && grid[rr][cc] === player) {
            cells.push({ r: rr, c: cc });
            rr += dr;
            cc += dc;
          }
          if (cells.length >= winLength) lines.push(cells);
        }
      }
    }
    return lines;
  }

  function judgeGrid(grid, size, winLength, observer) {
    const blackLines = findLines(grid, size, winLength, BLACK);
    const whiteLines = findLines(grid, size, winLength, WHITE);
    const lines = [
      ...blackLines.map((cells) => ({ player: BLACK, cells })),
      ...whiteLines.map((cells) => ({ player: WHITE, cells })),
    ];
    if (blackLines.length && whiteLines.length) return { winner: observer, reason: "both", lines };
    if (blackLines.length) return { winner: BLACK, reason: "line", lines };
    if (whiteLines.length) return { winner: WHITE, reason: "line", lines };
    return { winner: null, reason: "continue", lines: [] };
  }

  function estimate(game, samples = 360, rng = Math.random) {
    const observer = game.turn;
    let blackOnly = 0;
    let whiteOnly = 0;
    let both = 0;
    let none = 0;
    for (let i = 0; i < samples; i += 1) {
      const rolled = rollStones(game.stones, rng);
      const grid = gridFromRoll(rolled, game.size);
      const black = findLines(grid, game.size, game.winLength, BLACK).length > 0;
      const white = findLines(grid, game.size, game.winLength, WHITE).length > 0;
      if (black && white) both += 1;
      else if (black) blackOnly += 1;
      else if (white) whiteOnly += 1;
      else none += 1;
    }
    const n = samples || 1;
    const blackOnlyP = blackOnly / n;
    const whiteOnlyP = whiteOnly / n;
    const bothP = both / n;
    const noneP = none / n;
    const observerWin = observer === BLACK ? blackOnlyP + bothP : whiteOnlyP + bothP;
    const opponentWin = observer === BLACK ? whiteOnlyP : blackOnlyP;
    return { observer, blackOnly: blackOnlyP, whiteOnly: whiteOnlyP, both: bothP, none: noneP, observerWin, opponentWin, samples };
  }

  function stoneMap(stones) {
    const map = new Map();
    for (const stone of stones) map.set(key(stone.r, stone.c), stone);
    return map;
  }

  function windowsThrough(size, len, r, c) {
    const found = [];
    for (const [dr, dc] of DIRS) {
      for (let offset = 0; offset < len; offset += 1) {
        const sr = r - dr * offset;
        const sc = c - dc * offset;
        const er = sr + dr * (len - 1);
        const ec = sc + dc * (len - 1);
        if (sr < 0 || sc < 0 || er < 0 || ec < 0 || sr >= size || sc >= size || er >= size || ec >= size) continue;
        const cells = [];
        for (let i = 0; i < len; i += 1) cells.push({ r: sr + dr * i, c: sc + dc * i });
        found.push(cells);
      }
    }
    return found;
  }

  function windowProb(cells, color, map, place, pBlack) {
    let p = 1;
    for (const cell of cells) {
      let pb = null;
      if (cell.r === place.r && cell.c === place.c) pb = pBlack / 100;
      else if (map.has(key(cell.r, cell.c))) pb = map.get(key(cell.r, cell.c)).pBlack / 100;
      if (pb == null) p *= 0.38;
      else p *= color === BLACK ? pb : 1 - pb;
    }
    return p;
  }

  function candidates(game) {
    if (game.stones.length === 0) {
      const mid = (game.size - 1) / 2;
      const cells = [];
      for (let r = 0; r < game.size; r += 1) {
        for (let c = 0; c < game.size; c += 1) {
          if (Math.max(Math.abs(r - mid), Math.abs(c - mid)) <= 2) cells.push({ r, c });
        }
      }
      return cells;
    }
    const taken = new Set(game.stones.map((s) => key(s.r, s.c)));
    const near = new Set();
    for (const stone of game.stones) {
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const r = stone.r + dr;
          const c = stone.c + dc;
          if (!game.inBounds(r, c) || taken.has(key(r, c))) continue;
          near.add(key(r, c));
        }
      }
    }
    return [...near].map((id) => {
      const [r, c] = id.split(",").map(Number);
      return { r, c };
    });
  }

  function scoreCell(game, r, c, pBlack, player) {
    const map = stoneMap(game.stones);
    const opp = opponent(player);
    let mine = 0;
    let theirs = 0;
    for (const cells of windowsThrough(game.size, game.winLength, r, c)) {
      mine += windowProb(cells, player, map, { r, c }, pBlack);
      theirs += windowProb(cells, opp, map, { r, c }, pBlack);
    }
    const mid = (game.size - 1) / 2;
    return mine - 1.2 * theirs - (Math.abs(r - mid) + Math.abs(c - mid)) * 0.0008;
  }

  function chooseAiMove(game) {
    if (game.phase !== "place" || game.winner) return null;
    let best = -Infinity;
    let pick = null;
    for (const ownPercent of game.legalOwnPercents(game.turn)) {
      const pBlack = game.pBlackFor(game.turn, ownPercent);
      for (const cell of candidates(game)) {
        const score = scoreCell(game, cell.r, cell.c, pBlack, game.turn);
        if (score > best) {
          best = score;
          pick = { r: cell.r, c: cell.c, ownPercent };
        }
      }
    }
    return pick;
  }

  function aiWantsObserve(game, rng = Math.random) {
    if (game.phase !== "decide" || game.winner) return false;
    if (game.isFull()) return true;
    if (game.observationsLeft <= 0) return false;
    const est = estimate(game, 280, rng);
    if (est.observerWin >= 0.58 && est.observerWin > est.opponentWin) return true;
    if (est.observerWin >= 0.36 && est.observerWin >= est.opponentWin + 0.16) return true;
    return false;
  }

  return {
    BLACK,
    WHITE,
    STRENGTHS,
    opponent,
    playerName,
    coord,
    createGame,
    judgeGrid,
    estimate,
    chooseAiMove,
    aiWantsObserve,
  };
});
