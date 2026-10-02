const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BLACK,
  WHITE,
  createGame,
  chooseAiMove,
  aiWantsObserve,
} = require("./engine.js");

test("プレイヤー1は白90%か白70%だけ、90%は連続で置けない。プレイヤー2はその逆", () => {
  const game = createGame();
  assert.equal(game.turn, WHITE);
  assert.deepEqual(game.legalOwnPercents(WHITE), [90, 70]);

  game.place(4, 4, 90);
  assert.equal(game.stones[0].owner, WHITE);
  assert.equal(game.stones[0].ownPercent, 90);
  assert.equal(game.stones[0].pBlack, 10);
  game.pass();

  game.place(4, 5, 90);
  assert.equal(game.stones[1].owner, BLACK);
  assert.equal(game.stones[1].pBlack, 90);
  game.pass();

  assert.deepEqual(game.legalOwnPercents(WHITE), [70]);
  assert.equal(game.place(4, 6, 90).ok, false);
  assert.equal(game.stones.length, 2);
  game.place(4, 6, 70);
  assert.equal(game.stones[2].pBlack, 30);
  game.pass();

  assert.equal(game.place(4, 7, 90).ok, false);
  game.place(4, 7, 70);
  assert.equal(game.stones[3].owner, BLACK);
  assert.equal(game.stones[3].pBlack, 70);
  game.pass();

  assert.deepEqual(game.legalOwnPercents(WHITE), [90, 70]);
  game.place(4, 8, 70);
  assert.equal(game.stones[4].pBlack, 30);
});

test("同じ交点には置けず、観測前の二手目は置けない", () => {
  const game = createGame();
  game.place(1, 1);
  const again = game.place(1, 1);
  assert.equal(again.ok, false);
  assert.equal(game.stones.length, 1);
  const other = game.place(2, 2);
  assert.equal(other.ok, false);
});

test("揃わない観測は回数を消費して確率の状態に戻し、手番が移る", () => {
  const game = createGame({ random: () => 0.5 });
  game.place(0, 0);
  const result = game.observe();
  assert.equal(result.ok, true);
  assert.equal(result.winner, null);
  assert.equal(result.reverted, true);
  assert.equal(game.observations[WHITE], 4);
  assert.equal(game.observations[BLACK], 5);
  assert.equal(game.turn, BLACK);
  assert.equal(game.phase, "place");
  assert.equal(game.collapsed, null);
  assert.equal(game.stones.length, 1);
  assert.equal(game.stones[0].pBlack, 10);
  assert.equal(game.turn, BLACK);
});

test("観測で自分の色だけが5つ並べば、その色の勝ち", () => {
  const game = createGame({ random: () => 0 });
  game.stones = [0, 1, 2, 3, 4].map((c) => ({ r: 4, c, pBlack: 90, owner: BLACK }));
  game.phase = "decide";
  game.turn = BLACK;
  const result = game.observe();
  assert.equal(result.winner, BLACK);
  assert.equal(result.reason, "line");
  assert.equal(game.phase, "over");
  assert.ok(game.collapsed[4].every((color, c) => c > 4 || color === BLACK));
});

test("相手の色だけが揃った観測は、観測した側の負けになる", () => {
  const game = createGame({ random: () => 0.5 });
  game.stones = [0, 1, 2, 3, 4].map((c) => ({ r: 2, c, pBlack: 10, owner: WHITE }));
  game.phase = "decide";
  game.turn = BLACK;
  const result = game.observe();
  assert.equal(result.reason, "line");
  assert.equal(result.winner, WHITE);
});

test("両方揃ったときは観測した側の勝ち", () => {
  const stones = [
    ...[0, 1, 2, 3, 4].map((c) => ({ r: 0, c, pBlack: 90, owner: BLACK })),
    ...[0, 1, 2, 3, 4].map((c) => ({ r: 1, c, pBlack: 10, owner: WHITE })),
  ];

  const blackObserves = createGame({ random: () => 0.5 });
  blackObserves.stones = stones.map((s) => ({ ...s }));
  blackObserves.phase = "decide";
  blackObserves.turn = BLACK;
  const blackResult = blackObserves.observe();
  assert.equal(blackResult.reason, "both");
  assert.equal(blackResult.winner, BLACK);

  const whiteObserves = createGame({ random: () => 0.5 });
  whiteObserves.stones = stones.map((s) => ({ ...s }));
  whiteObserves.phase = "decide";
  whiteObserves.turn = WHITE;
  const whiteResult = whiteObserves.observe();
  assert.equal(whiteResult.reason, "both");
  assert.equal(whiteResult.winner, WHITE);
});

test("観測はひとり5回までで、切れたプレイヤーは置くと手番が渡る", () => {
  const game = createGame({ random: () => 0.2 });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(game.turn, WHITE);
    const placed = game.place(0, i);
    assert.equal(placed.ok, true);
    const seen = game.observe();
    assert.equal(seen.reverted, true);
    assert.equal(seen.refilled, false);
    assert.equal(game.observations[WHITE], 4 - i);
    assert.equal(game.observations[BLACK], 5);
    game.place(1, i);
    game.pass();
  }
  assert.equal(game.observations[WHITE], 0);
  assert.equal(game.turn, WHITE);
  const placed = game.place(7, 7);
  assert.equal(placed.autoPassed, true);
  assert.equal(game.turn, BLACK);
  game.place(7, 8);
  assert.equal(game.phase, "decide");
  const seen = game.observe();
  assert.equal(seen.ok, true);
  assert.equal(game.observations[BLACK], 4);
  assert.equal(game.observations[WHITE], 0);
});

test("ふたりとも観測を使い切ると、それぞれ1回回復する", () => {
  const game = createGame({ random: () => 0.2 });
  const cells = [];
  for (let r = 0; r < 9; r += 2) {
    for (let c = 0; c < 9; c += 2) cells.push([r, c]);
  }
  let n = 0;
  const put = () => {
    const [r, c] = cells[n];
    n += 1;
    return game.place(r, c);
  };
  for (let i = 0; i < 5; i += 1) {
    put();
    game.observe();
    put();
    game.pass();
  }
  for (let i = 0; i < 4; i += 1) {
    const passed = put();
    assert.equal(passed.autoPassed, true);
    put();
    const seen = game.observe();
    assert.equal(seen.refilled, false);
    assert.equal(game.observations[BLACK], 4 - i);
    assert.equal(game.observations[WHITE], 0);
  }
  assert.equal(put().autoPassed, true);
  put();
  const last = game.observe();
  assert.equal(last.reverted, true);
  assert.equal(last.refilled, true);
  assert.equal(game.observations[WHITE], 1);
  assert.equal(game.observations[BLACK], 1);
  assert.equal(game.turn, WHITE);
  game.place(1, 1);
  assert.equal(game.phase, "decide");
  game.observe();
  assert.equal(game.observations[WHITE], 0);
  assert.equal(game.observations[BLACK], 1);
});

test("盤が埋まって観測回数も無いときは終局観測で引き分けにできる", () => {
  const game = createGame({ size: 4, winLength: 5, random: () => 0.5 });
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      game.stones.push({ r, c, pBlack: 90, owner: BLACK });
    }
  }
  game.phase = "decide";
  game.observations[BLACK] = 0;
  game.observations[WHITE] = 0;
  game.turn = BLACK;
  const result = game.observe();
  assert.equal(result.winner, "draw");
  assert.equal(game.phase, "over");
});

test("待ったで観測も着手も戻る", () => {
  const game = createGame({ random: () => 0.5 });
  game.place(4, 4);
  game.observe();
  assert.equal(game.turn, BLACK);
  assert.equal(game.observations[WHITE], 4);
  assert.equal(game.observations[BLACK], 5);
  assert.equal(game.undo(), true);
  assert.equal(game.phase, "decide");
  assert.equal(game.turn, WHITE);
  assert.equal(game.observations[WHITE], 5);
  assert.equal(game.observations[BLACK], 5);
  assert.equal(game.undo(), true);
  assert.equal(game.stones.length, 0);
  assert.equal(game.phase, "place");
});

test("5つ並ぶ局面では観測し、相手だけが揃う局面では観測しない", () => {
  const winning = createGame({ random: () => 0 });
  winning.stones = [0, 1, 2, 3, 4].map((c) => ({ r: 4, c, pBlack: 90, owner: BLACK }));
  winning.phase = "decide";
  winning.turn = BLACK;
  assert.equal(aiWantsObserve(winning, () => 0), true);

  const losing = createGame({ random: () => 0.5 });
  losing.stones = [0, 1, 2, 3, 4].map((c) => ({ r: 4, c, pBlack: 10, owner: WHITE }));
  losing.phase = "decide";
  losing.turn = BLACK;
  assert.equal(aiWantsObserve(losing, () => 0.5), false);
});

test("初手は中央に白90%を置く", () => {
  const game = createGame();
  assert.deepEqual(chooseAiMove(game), { r: 4, c: 4, ownPercent: 90 });
});
