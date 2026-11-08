import { combination, drawEquity, pairCombos, requiredCallEquity, shownPercent } from "./combos.js";

export const BOOT_CONTENT_VERSION = "2026.11.8-boot";
export const TABLE_ASSUMPTION = "牌局人數和深度尚未確認。本課表暫定 8 到 9 人、有效籌碼多在 100 到 200BB。這是假設，不是濟州現場的定論。";
export const PEDAGOGY_NOTE = "新鮮題第一次作答的教學目標是 80%。這不是長期贏牌的保證，也不要求每題都要快。";

const DAY_META = [
  ["2026-11-08", "阻擋要同時算被拿掉的價值和詐唬", "blockers", "study", 4],
  ["2026-11-09", "河牌先分開數價值組合和詐唬組合", "combos", "study", 4],
  ["2026-11-10", "抓詐唬時擋價值，詐唬時不要只擋棄牌", "blockers", "study", 4],
  ["2026-11-11", "用簡化範圍把組數和賠率比完", "combos", "study", 4],
  ["2026-11-12", "強半詐唬要主動", "aggression", "study", 4],
  ["2026-11-13", "聽牌的尺寸，以及下一條街怎麼打", "aggression", "study", 4],
  ["2026-11-14", "中等攤牌牌不要為了趕高牌而加注", "showdown", "study", 4],
  ["2026-11-15", "保住攤牌價值，薄價值另算", "showdown", "study", 4],
  ["2026-11-16", "多人底池不要沿用單挑的持續下注", "multiway", "study", 4],
  ["2026-11-17", "多人底池的尺寸和後面兩條街", "multiway", "study", 4],
  ["2026-11-18", "先寫下位置、有效籌碼和底池", "tracking", "study", 4],
  ["2026-11-19", "SPR 是有效籌碼除以底池", "tracking", "study", 4],
  ["2026-11-20", "每一條街都把底池重算一次", "tracking", "study", 4],
  ["2026-11-21", "150 到 250BB：深籌碼不是把 100BB 的尺寸直接放大", "tracking", "study", 4],
  ["2026-11-22", "若這手有 straddle，底池和 SPR 都會變", "tracking", "study", 4],
  ["2026-11-23", "翻牌、轉牌、河牌要接得起來", "tracking", "study", 4],
  ["2026-11-24", "新鮮混合測驗，舊成績不算這份考卷", "mixed", "test", 6],
  ["2026-11-25", "第二份新鮮混合測驗", "mixed", "test", 6],
  ["2026-11-26", "輕複習，然後對上桌清單", "mixed", "light", 4],
];

function scheduleFor(kind) {
  if (kind === "test") {
    return [
      { minutes: 2, title: "說明", detail: "這六題是新鮮題。三天基本功和前面各天的成績都不算進這份測驗。" },
      { minutes: 26, title: "六題未見過的混合題", detail: "做完才看講解。不要求一律快答。" },
      { minutes: 2, title: "一句話", detail: "只寫下一個下次會執行的動作。" },
    ];
  }
  if (kind === "light") {
    return [
      { minutes: 4, title: "輕複習", detail: "若有真正答錯的題，只看一題。沒有就做基準題。不把沒做的天數補成已完成。" },
      { minutes: 16, title: "四題輕量複習", detail: "不再加新的難題。" },
      { minutes: 8, title: "上桌清單", detail: "买入和這趟虧損上限分開填。留空就保持空白，不代填金額。" },
      { minutes: 2, title: "一句話", detail: "寫一個上桌前會做到的動作。" },
    ];
  }
  return [
    { minutes: 5, title: "複習", detail: "一題真正答錯的舊題。第一天或還沒有錯題時，改做基準題。" },
    { minutes: 15, title: "四題新情境", detail: "送出後才看講解。" },
    { minutes: 8, title: "最深的一題錯", detail: "只分析今天新鮮題裡真正答錯的。答對但較慢不算弱點。" },
    { minutes: 2, title: "一句話", detail: "寫下一個下次會執行的動作。" },
  ];
}

function cardsOf(list) {
  const seen = new Set();
  for (const card of list) {
    if (!/^[AKQJT2-9][shdc]$/.test(card) || seen.has(card)) return false;
    seen.add(card);
  }
  return true;
}

function unused(board, prefer) {
  const used = new Set(board);
  for (const card of prefer) if (!used.has(card)) return card;
  for (const rank of "AKQJT98765432") {
    for (const suit of "shdc") {
      const card = `${rank}${suit}`;
      if (!used.has(card)) return card;
    }
  }
  throw new Error("deck empty");
}

function spotLine({ seats, hero, villain, stack, extra }) {
  return `${seats} 人桌假設，有效籌碼 ${stack}BB。你在 ${hero}，主要對手在 ${villain}。${extra} ${TABLE_ASSUMPTION}`;
}

const SEATS = [
  ["9", "CO", "BTN"],
  ["8", "BTN", "BB"],
  ["9", "HJ", "CO"],
  ["8", "SB", "BB"],
  ["9", "UTG", "HJ"],
  ["8", "MP", "BTN"],
];

function finish(partial) {
  const hands = [partial.hand, ...(partial.optionHands || [])].filter(Boolean);
  const all = [...partial.board, ...hands.flat()];
  if (!cardsOf(all)) throw new Error(`bad cards ${partial.id} ${all.join(" ")}`);
  return {
    courseId: "bootcamp",
    contentVersion: BOOT_CONTENT_VERSION,
    role: partial.role || "core",
    blind: Boolean(partial.blind),
    date: partial.date,
    day: Number(partial.date.slice(-2)),
    legacyIndex: partial.order,
    acceptedOptionIds: partial.acceptedOptionIds || [partial.correctOptionId],
    assumptions: partial.assumptions || null,
    hand: partial.hand || null,
    board: partial.board,
    ...partial,
  };
}

function bluffcatch(spec) {
  const equity = requiredCallEquity(spec.pot, spec.bet);
  const share = spec.bluff / (spec.value + spec.bluff);
  const fold = share + 1e-12 < equity;
  const [seats, hero, villain] = SEATS[spec.n % SEATS.length];
  return finish({
    id: spec.id,
    date: spec.date,
    order: spec.order,
    blind: spec.blind,
    tags: ["combos", "pot-odds"],
    board: spec.board,
    hand: spec.hand,
    spot: spotLine({
      seats,
      hero,
      villain,
      stack: spec.stack,
      extra: `河牌底池 ${spec.pot}BB，${villain} 下注 ${spec.bet}BB。這題給定的簡化範圍是價值 ${spec.value} 組、詐唬 ${spec.bluff} 組，不是把牌面上所有手牌都列完。`,
    }),
    prompt: "你的牌輸給全部價值、贏過全部詐唬。該怎麼做？",
    options: [
      { id: "a", text: "跟注" },
      { id: "b", text: "棄牌" },
    ],
    correctOptionId: fold ? "b" : "a",
    assumptions: "簡化範圍只含題目給的價值組和詐唬組。",
    explanation: `需要勝率 ${shownPercent(equity)}%。詐唬比例 ${shownPercent(share)}%（${spec.bluff}÷${spec.value + spec.bluff}）。價值 ${spec.value} 組和詐唬 ${spec.bluff} 組要一起看，不能只盯著對手的強牌。${fold ? "詐唬比例低於需要的勝率，棄牌。" : "詐唬比例不低於需要的勝率，跟注。"}`,
    model: { type: "bluffcatch", pot: spec.pot, bet: spec.bet, value: spec.value, bluff: spec.bluff, foldOptionId: "b", callOptionId: "a" },
  });
}

function flushQuestion(spec) {
  const suit = spec.suit;
  const left = 13 - spec.board.filter((card) => card[1] === suit).length;
  const full = combination(left, 2);
  const blocked = combination(left - 1, 2);
  const removed = full - blocked;
  const [seats, hero, villain] = SEATS[spec.n % SEATS.length];
  return finish({
    id: spec.id,
    date: spec.date,
    order: spec.order,
    blind: spec.blind,
    tags: ["blockers"],
    board: spec.board,
    hand: null,
    optionHands: [spec.blockHand, spec.cleanHand],
    spot: spotLine({
      seats,
      hero,
      villain,
      stack: spec.stack,
      extra: `河牌 ${villain} 下注。你要抓詐唬。同花組合要按實際剩下的牌數算，而且這張阻擋牌同時也可能影響詐唬，不能只背「有阻擋就跟」。`,
    }),
    prompt: "哪手比較能減少對手的同花價值？",
    options: [
      { id: "a", text: spec.blockLabel },
      { id: "b", text: spec.cleanLabel },
      { id: "c", text: "兩手擋掉的同花一樣多" },
    ],
    correctOptionId: "a",
    explanation: `這個花色外面還有 ${left} 張，同花 C(${left},2)=${full} 組。拿著阻擋牌之後剩 C(${left - 1},2)=${blocked} 組，少 ${removed} 組。另一手沒有這個花色，同花仍是 ${full} 組。少的是這 ${removed} 組同花價值，不是對手的每一種牌，也沒有自動告訴你該跟注。`,
    model: { type: "flush", suitLeft: left },
  });
}

function pairQuestion(spec) {
  const used = [...spec.board, ...(spec.hand || [])].filter((card) => card[0] === spec.rank).length;
  const left = 4 - used;
  const answer = pairCombos(left);
  const options = [answer, answer + 3, Math.max(0, answer - 2)].filter((value, index, list) => list.indexOf(value) === index);
  while (options.length < 3) options.push(options[options.length - 1] + 4);
  const correctIndex = 0;
  const [seats, hero, villain] = SEATS[spec.n % SEATS.length];
  return finish({
    id: spec.id,
    date: spec.date,
    order: spec.order,
    blind: spec.blind,
    tags: ["combos"],
    board: spec.board,
    hand: spec.hand,
    spot: spotLine({
      seats,
      hero,
      villain,
      stack: spec.stack,
      extra: `你要數口袋對 ${spec.rank}${spec.rank} 還剩幾組。公共牌和你的手牌用掉的都要扣。`,
    }),
    prompt: `${spec.rank}${spec.rank} 還剩幾組？`,
    options: options.slice(0, 3).map((value, index) => ({ id: "abc"[index], text: `${value} 組` })),
    correctOptionId: "abc"[correctIndex],
    explanation: `這個點數總共 4 張，已經用掉 ${used} 張，剩 ${left} 張。C(${left},2)=${answer} 組。`,
    model: { type: "pair", left, alsoPairs: [] },
  });
}

function sprQuestion(spec) {
  const spr = spec.stack / spec.pot;
  const shown = Math.round(spr);
  const wrongA = shown + 15;
  const wrongB = Math.max(1, shown - 12);
  const [seats, hero, villain] = SEATS[spec.n % SEATS.length];
  return finish({
    id: spec.id,
    date: spec.date,
    order: spec.order,
    blind: spec.blind,
    tags: ["tracking"],
    board: spec.board,
    hand: spec.hand,
    spot: spotLine({
      seats,
      hero,
      villain,
      stack: spec.stack,
      extra: `這一街開始時底池 ${spec.pot}BB。SPR 用有效籌碼除以當時的底池。`,
    }),
    prompt: "這時的 SPR 大約是多少？",
    options: [
      { id: "a", text: String(shown) },
      { id: "b", text: String(wrongA) },
      { id: "c", text: String(wrongB) },
    ],
    correctOptionId: "a",
    explanation: `${spec.stack}÷${spec.pot}=${spr}，四捨五入是 ${shown}。深籌碼或 straddle 都會改這個數字，不能沿用別的底池。`,
    model: { type: "spr", stack: spec.stack, pot: spec.pot, shown },
  });
}

function potQuestion(spec) {
  const pot = spec.chips.reduce((sum, chip) => sum + chip, 0);
  const [seats, hero, villain] = SEATS[spec.n % SEATS.length];
  return finish({
    id: spec.id,
    date: spec.date,
    order: spec.order,
    blind: spec.blind,
    tags: ["tracking", "pot-odds"],
    board: spec.board,
    hand: spec.hand,
    spot: spotLine({
      seats,
      hero,
      villain,
      stack: spec.stack,
      extra: `籌碼進出：${spec.chipText}。把實際放進底池的籌碼加總。`,
    }),
    prompt: "現在底池是多少 BB？",
    options: [
      { id: "a", text: `${pot}BB` },
      { id: "b", text: `${pot + 4}BB` },
      { id: "c", text: `${Math.max(1, pot - 3)}BB` },
    ],
    correctOptionId: "a",
    explanation: `${spec.chips.join("+")}=${pot}。底池要按這條街實際進去的籌碼重算。`,
    model: { type: "pot", chips: spec.chips, pot },
  });
}

function outsQuestion(spec) {
  const unseen = spec.street === "flop" ? 47 : 46;
  const equity = shownPercent(drawEquity(spec.outs, unseen, spec.street === "flop" ? 2 : 1));
  const rule = spec.street === "flop"
    ? "本題假設：只算這些乾淨出牌，而且翻牌兩張牌都會看到。勝率高於 50% 才把這手當強半詐唬並主動下注，否則過牌。這不是求解器的唯一答案。"
    : "本題假設：轉牌只剩一張牌。勝率高於 30% 且你有位置，才主動下注，否則過牌。這不是求解器的唯一答案。";
  const bet = spec.street === "flop" ? equity > 50 : equity > 30;
  const [seats, hero, villain] = SEATS[spec.n % SEATS.length];
  return finish({
    id: spec.id,
    date: spec.date,
    order: spec.order,
    blind: spec.blind,
    tags: ["aggression"],
    board: spec.board,
    hand: spec.hand,
    spot: spotLine({
      seats,
      hero,
      villain,
      stack: spec.stack,
      extra: `${spec.street === "flop" ? "翻牌" : "轉牌"} ${villain} 過牌。你有 ${spec.outs} 張題目指定的乾淨出牌。${rule}`,
    }),
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: spec.street === "flop" ? "主動下注約 2/3 底池" : "主動下注約 1/2 到 2/3 底池" },
    ],
    correctOptionId: bet ? "b" : "a",
    assumptions: rule,
    explanation: `${spec.outs} 張出牌，${spec.street === "flop" ? "翻牌看到河牌" : "轉牌看到河牌"}約 ${equity}%。${rule} ${bet ? "所以這題選主動下注。" : "所以這題選過牌。"} 中等成牌不要抄強聽牌的尺寸。`,
    model: { type: "outs", outs: spec.outs, unseen, cards: spec.street === "flop" ? 2 : 1, hideEquity: false },
  });
}

const STRATEGY = [
  {
    date: "2026-11-12",
    tags: ["aggression"],
    board: ["Js", "8s", "3d"],
    hand: ["As", "5s"],
    seats: "9", hero: "BTN", villain: "BB", stack: 100,
    extra: "你開池到 2.5BB，大盲跟注，小盲棄牌。底池 6.5BB（含小盲 0.5）。翻牌大盲過牌。你有堅果同花聽牌。本題假設：9 張以上的乾淨聽牌，又在按鈕，應該主動下約 2/3 到滿池，而不是只過牌拿免費牌。這不是求解器唯一解。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注 1/3 底池" },
      { id: "c", text: "下注約 2/3 到滿池" },
    ],
    correctOptionId: "c",
    explanation: "黑桃出牌 9 張。A♠ 在你手上，對手沒有 A♠ 配另一張黑桃的堅果聽牌。本題假設把這種強半詐唬主動下大，而不是過牌。中等成牌不要抄這個尺寸。",
  },
  {
    date: "2026-11-12",
    tags: ["aggression"],
    board: ["8h", "7c", "3h"],
    hand: ["Th", "9h"],
    seats: "8", hero: "BB", villain: "BTN", stack: 100,
    extra: "按鈕開池，你在大盲跟注。翻牌你過牌，按鈕下注 1/3 底池。你有兩頭順加同花聽牌。本題假設：這種約 15 張乾淨出牌的牌要過牌加注，第二對則應該跟注。兩者不要用同一套。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "棄牌" },
      { id: "b", text: "跟注" },
      { id: "c", text: "過牌加注" },
    ],
    correctOptionId: "c",
    explanation: "紅心 9 張，再加上非紅心的 J 和 6 共 6 張，合計 15 張乾淨出牌。翻牌看到河牌約 54%。本題假設這種強聽牌過牌加注。這不是說所有聽牌都該加注。",
  },
  {
    date: "2026-11-13",
    tags: ["aggression", "blockers"],
    board: ["Js", "8s", "3d", "2c", "Kh"],
    hand: ["As", "5s"],
    seats: "9", hero: "BTN", villain: "BB", stack: 100,
    extra: "延續強聽牌那手：轉牌你下注被跟，河牌 K♥，你沒中同花，大盲過牌。本題假設：A 高幾乎沒有攤牌價值才繼續詐唬；同時要承認 A♠5♠ 會擋到一些沒中的黑桃聽牌，那些牌本來比較會棄，對詐唬是減分。沒有「聽牌沒中就一定要打」的規則。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌放棄" },
      { id: "b", text: "下注約 2/3 底池詐唬" },
    ],
    correctOptionId: "b",
    acceptedOptionIds: ["b"],
    explanation: "沒中的黑桃聽牌從 C(11,2)=55 組，被你兩張黑桃擋到剩 C(9,2)=36 組，少 19 組會棄的牌。這對詐唬是減分。本題仍選詐唬，是因為 A 高對跟了兩條街的範圍幾乎沒有攤牌價值，不是因為「沒有擋到聽牌」。",
  },
  {
    date: "2026-11-13",
    tags: ["aggression"],
    board: ["Ks", "7d", "3c", "9d"],
    hand: ["Qd", "Jd"],
    seats: "8", hero: "BTN", villain: "BB", stack: 120,
    extra: "你在按鈕開池，大盲跟注。翻牌你下注被跟。轉牌 9♦，大盲過牌。你有卡順加方塊聽牌。本題假設：12 張出牌、翻牌看到河牌約 45% 的半詐唬可以下注約 2/3，但沒有棄牌收益時不要當成已經領先。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注約 2/3 底池" },
    ],
    correctOptionId: "b",
    explanation: "方塊 9 張，非方塊的 T 還有 3 張，共 12 張出牌。對上只輸給這些出牌的成牌，看到河牌約 45%。加上棄牌收益，本題假設可以下注。這不是堅果聽牌。",
  },
  {
    date: "2026-11-14",
    tags: ["showdown"],
    board: ["Kd", "8c", "4s"],
    hand: ["9h", "8h"],
    seats: "9", hero: "BB", villain: "BTN", stack: 100,
    extra: "按鈕開池，你在大盲跟注。翻牌你過牌，按鈕下注 1/3 底池。你是第二對。本題假設：加注的目的若只是讓高牌棄掉，那些高牌很多本來就贏不了你，加注會把能抓詐唬的牌打成詐唬。所以選跟注。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "棄牌" },
      { id: "b", text: "跟注" },
      { id: "c", text: "過牌加注，只為了讓 A 高和 Q 高棄牌" },
    ],
    correctOptionId: "b",
    explanation: "第二對有攤牌價值。為了趕高牌而加注，會讓比你差的牌棄掉，繼續的多半更強。本題假設選跟注。暗三條或強聽牌才是比較適合加注的牌。",
  },
  {
    date: "2026-11-14",
    tags: ["showdown"],
    board: ["Qd", "7c", "3s", "2h"],
    hand: ["Js", "Jc"],
    seats: "8", hero: "BB", villain: "BTN", stack: 100,
    extra: "翻牌你過牌跟注 1/3。轉牌你過牌，按鈕下注 2/3 底池。你是超對以下的中等口袋對。本題假設：這手加注時，比你差的牌多半棄掉，繼續的常是 Qx。選跟注。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "棄牌" },
      { id: "b", text: "跟注" },
      { id: "c", text: "過牌加注" },
    ],
    correctOptionId: "b",
    explanation: "JJ 贏得了按鈕不少詐唬和薄價值。加注會把這些牌趕跑。本題假設跟注，不是因為口袋對永遠不能加注。",
  },
  {
    date: "2026-11-15",
    tags: ["showdown"],
    board: ["Qs", "9d", "4c", "7h", "2s"],
    hand: ["9c", "8c"],
    seats: "9", hero: "BTN", villain: "BB", stack: 100,
    extra: "你在按鈕連續下注兩街都被跟，河牌對手過牌。你是中間對。本題假設：比你差的牌很少再跟第三槍，比你好的會跟，而你還能贏一些沒中的聽牌，所以過牌，不把這手當純詐唬。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注 1/2 當薄價值" },
      { id: "c", text: "滿池詐唬" },
    ],
    correctOptionId: "a",
    explanation: "跟了兩條街的範圍裡，會再跟注的多半是 Qx 或更好的牌。中間對有一些攤牌價值。本題假設過牌。若範圍裡真的有很多更差的第二對會跟，薄價值才需要另算。",
  },
  {
    date: "2026-11-15",
    tags: ["showdown", "pot-odds"],
    board: ["As", "Kd", "8c", "4h", "2s"],
    hand: ["Ah", "Qc"],
    seats: "8", hero: "BB", villain: "BTN", stack: 140,
    extra: "河牌底池 40BB，按鈕超池下注 80BB。這題只問賠率，還沒有給價值和詐唬的組數。",
    prompt: "你需要多少勝率才夠跟注？",
    options: [
      { id: "a", text: "33%" },
      { id: "b", text: "40%" },
      { id: "c", text: "50%" },
    ],
    correctOptionId: "b",
    explanation: "80÷(40+80+80)=40%。只有賠率，不能直接決定跟或棄。頂對在這裡有攤牌價值，但是否跟注還要看價值組和詐唬組。",
  },
  {
    date: "2026-11-16",
    tags: ["multiway"],
    board: ["Ad", "7c", "2s"],
    hand: ["Jh", "Jd"],
    seats: "9", hero: "CO", villain: "BTN、SB、BB", stack: 100,
    extra: "你在 CO 開 2.5BB，按鈕、小盲、大盲都跟。四人底池，小盲和大盲過牌給你。本題假設：多人底池裡中等對子下注時，會跟的多半是 Ax，比你差的很少跟。不要用單挑的持續下注頻率。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注 1/3" },
      { id: "c", text: "下注 3/4" },
    ],
    correctOptionId: "a",
    explanation: "三個對手裡有人拿著 A 的機會不低。JJ 在這裡下注，既不是清楚的價值，也不是好詐唬。本題假設過牌。這不是說口袋對在多人底池永遠不能下注。",
  },
  {
    date: "2026-11-16",
    tags: ["multiway"],
    board: ["Kh", "9c", "4d"],
    hand: ["Ac", "Kd"],
    seats: "8", hero: "CO", villain: "BTN 和 BB", stack: 100,
    extra: "三人底池，你在 CO 開池，按鈕和大盲跟注。大盲過牌。你是頂對頂踢腳。本題假設：多人底池有真正領先的牌就下注拿價值，不要因為「多人」就自動過牌。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌慢打" },
      { id: "b", text: "下注約 1/2 到 2/3 底池" },
    ],
    correctOptionId: "b",
    explanation: "頂對頂踢腳會被不少 Kx、9x 和聽牌跟注。過牌讓他們免費看牌。本題假設下注。中等對子才是前面那題要過牌的牌。",
  },
  {
    date: "2026-11-17",
    tags: ["multiway"],
    board: ["Kc", "5c", "2d"],
    hand: ["9c", "8c"],
    seats: "9", hero: "BB", villain: "CO 和 BTN", stack: 100,
    extra: "CO 開池，你在大盲跟注，按鈕也跟。翻牌你過牌，CO 下注 1/3，按鈕跟注。你有同花聽牌，夾在中間。本題假設：多人底池這手跟注，不加注。題目沒有給精確底池，不編一個假賠率。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "棄牌" },
      { id: "b", text: "跟注" },
      { id: "c", text: "過牌加注" },
    ],
    correctOptionId: "b",
    explanation: "已經有兩個人投入。同花聽牌通常跟得起，但加注時棄牌收益低，按鈕還可能再加。單挑裡可以加注的聽牌，多人底池要收斂。",
  },
  {
    date: "2026-11-17",
    tags: ["multiway"],
    board: ["Kc", "7d", "2h"],
    hand: ["6c", "6d"],
    seats: "8", hero: "BTN", villain: "CO 和 BB", stack: 100,
    extra: "你在按鈕跟注 CO 的開池，大盲也跟。翻牌兩人都過牌到你。本題假設：小對子在多人底池有攤牌價值，下注多半只被 Kx 跟。不在這裡偷池。",
    prompt: "在這題的假設下，你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注 1/3 偷池" },
    ],
    correctOptionId: "a",
    explanation: "兩個人都過牌，不代表單挑那種持續下注還適用。66 過牌可以免費看牌，也可能在攤牌贏過空氣。本題假設不偷。",
  },
  {
    date: "2026-11-21",
    tags: ["tracking", "showdown"],
    board: ["Tc", "6d", "2c"],
    hand: ["Ah", "Qh"],
    seats: "9", hero: "BTN", villain: "BB", stack: 200,
    extra: "有效籌碼 200BB，不是 100BB。你在按鈕開池，大盲跟注。翻牌大盲過牌。你是兩張高牌，沒有成牌。本題假設：深籌碼時，沒有成牌又沒有強聽牌的高牌不要用 100BB 的大尺寸持續下注去承諾後面的籌碼。選小注或過牌都可以，這題把兩者都算對。",
    prompt: "在這題的假設下，哪些做法可以？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注約 1/3 底池" },
      { id: "c", text: "下注滿池，打算後面兩街都打光 200BB" },
    ],
    correctOptionId: "a",
    acceptedOptionIds: ["a", "b"],
    explanation: "200BB 的 SPR 比 100BB 高，後面還有很多籌碼。AQ 高在這個乾牌面沒有必須打光的理由。過牌或小注都符合本題假設。滿池並計畫打光不符合。",
  },
  {
    date: "2026-11-22",
    tags: ["tracking"],
    board: [],
    hand: null,
    seats: "9", hero: "BTN", villain: "UTG", stack: 200,
    extra: "盲注 0.5/1。本題假設 UTG 在發牌前 straddle 到 2BB，其他人都還沒入池。底池是小盲 0.5、大盲 1、straddle 2。有效籌碼仍用 200BB 去除這個底池。",
    prompt: "straddle 之後、還沒有人再加注時，SPR 大約是多少？",
    options: [
      { id: "a", text: "57" },
      { id: "b", text: "100" },
      { id: "c", text: "200" },
    ],
    correctOptionId: "a",
    explanation: "底池 0.5+1+2=3.5BB。200÷3.5≈57。沒有 straddle 時底池只有 1.5BB，SPR 會大很多。所以有沒有 straddle 要分開算。",
  },
  {
    date: "2026-11-23",
    tags: ["tracking", "aggression"],
    board: ["Qs", "Td", "4c", "2h"],
    hand: ["As", "Ks"],
    seats: "9", hero: "CO", villain: "BB", stack: 150,
    extra: "有效 150BB。你在 CO 開池，大盲跟注。翻牌你下注 1/3 被跟。轉牌 2♥，大盲過牌。你沒有成牌，只有兩張高牌和後門。本題假設：強聽牌才計畫轉牌下大並在河牌繼續；這手沒有那個聽牌，轉牌過牌，不把翻牌的下注自動打成三條街。",
    prompt: "在這題的假設下，轉牌你怎麼做？",
    options: [
      { id: "a", text: "過牌" },
      { id: "b", text: "下注 2/3，並預設河牌再打一槍" },
    ],
    correctOptionId: "a",
    explanation: "AK 高在 Q 高牌面，轉牌沒有新增的強聽牌。150BB 還很深，自動三槍會把很多籌碼打進劣勢。本題假設過牌。若轉牌是一張黑桃，讓你變成同花聽牌，計畫才要改。",
  },
  {
    date: "2026-11-26",
    tags: ["pot-odds"],
    board: ["Kd", "Qc", "5s", "2d", "9c"],
    hand: ["Kh", "Th"],
    seats: "8", hero: "BB", villain: "BTN", stack: 100,
    extra: "輕複習。河牌底池 30BB，按鈕下注 15BB。這題只問需要的勝率。",
    prompt: "跟注需要多少勝率？",
    options: [
      { id: "a", text: "25%" },
      { id: "b", text: "33%" },
      { id: "c", text: "50%" },
    ],
    correctOptionId: "a",
    explanation: "15÷(30+15+15)=15÷60=25%。半池需要 25%。這還沒有價值組和詐唬組，不能單憑賠率說一定跟。",
  },
];

function strategyQuestion(spec, order, blind) {
  return finish({
    ...spec,
    order,
    blind,
    role: "core",
    acceptedOptionIds: spec.acceptedOptionIds || [spec.correctOptionId],
    spot: spotLine({
      seats: spec.seats,
      hero: spec.hero,
      villain: spec.villain,
      stack: spec.stack,
      extra: spec.extra,
    }),
    assumptions: spec.extra,
  });
}

const FLUSH_BOARDS = [
  ["Ah", "Th", "3h", "7c", "8d"],
  ["Kh", "9h", "4h", "2c", "5d"],
  ["Qh", "8h", "2h", "6c", "Td"],
  ["Jh", "7h", "5h", "3c", "9d"],
  ["Ah", "9h", "6h", "4s", "2d"],
  ["Kh", "Th", "2h", "8c", "3s"],
  ["Qh", "5h", "3h", "9c", "4d"],
  ["Jh", "9h", "4h", "2s", "6c"],
  ["As", "Ts", "4s", "7d", "2c"],
  ["Ks", "9s", "3s", "6d", "8c"],
  ["Qs", "7s", "2s", "5d", "9c"],
  ["Js", "6s", "4s", "8d", "3c"],
  ["Ad", "9d", "5d", "2h", "7c"],
  ["Kd", "Td", "4d", "3h", "6s"],
  ["Qd", "8d", "3d", "5c", "2s"],
  ["Jd", "7d", "2d", "9c", "4h"],
];

function offsuitCards(used, suit, count) {
  const cards = [];
  for (const rank of "AKQJT98765432") {
    for (const item of "shdc") {
      if (item === suit) continue;
      const card = `${rank}${item}`;
      if (!used.has(card)) cards.push(card);
      if (cards.length === count) return cards;
    }
  }
  throw new Error("not enough offsuit cards");
}

function blockHand(board) {
  const suit = board.find((card) => board.filter((item) => item[1] === card[1]).length >= 3)[1];
  const blocker = unused(board, [..."AKQJT98765432"].map((rank) => `${rank}${suit}`));
  const used = new Set([...board, blocker]);
  const [kicker, cleanA, cleanB] = offsuitCards(used, suit, 3);
  const symbol = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const label = (card) => `${card[0] === "T" ? "10" : card[0]}${symbol[card[1]]}`;
  return {
    suit,
    blockHand: [blocker, kicker],
    cleanHand: [cleanA, cleanB],
    blockLabel: `${label(blocker)}${label(kicker)}`,
    cleanLabel: `${label(cleanA)}${label(cleanB)}`,
  };
}

const PAIR_BOARDS = [
  { board: ["8d", "3c", "Js", "2h", "Kc"], hand: null, rank: "8" },
  { board: ["Ac", "Ad", "7s", "4c", "2h"], hand: ["Kh", "Qd"], rank: "A" },
  { board: ["5h", "5c", "5d", "9s", "2c"], hand: ["As", "Kd"], rank: "5" },
  { board: ["Qh", "Jd", "4c", "2s", "7d"], hand: ["Qs", "9c"], rank: "Q" },
  { board: ["Th", "6c", "2d", "9s", "3h"], hand: null, rank: "T" },
  { board: ["Kh", "7d", "7c", "2s", "4d"], hand: ["Ah", "Qc"], rank: "7" },
  { board: ["9d", "4s", "3c", "2h", "8s"], hand: ["9c", "9h"], rank: "9" },
  { board: ["Jd", "Tc", "6s", "4h", "2d"], hand: null, rank: "J" },
];

const CATCHES = [
  { pot: 40, bet: 40, value: 18, bluff: 6, stack: 100, board: ["Th", "7h", "4c", "2s", "Ad"], hand: ["Ts", "9s"] },
  { pot: 50, bet: 50, value: 20, bluff: 12, stack: 120, board: ["Kc", "8d", "3s", "2h", "6c"], hand: ["Kd", "Qc"] },
  { pot: 60, bet: 30, value: 10, bluff: 10, stack: 150, board: ["Qs", "9c", "4d", "2h", "7s"], hand: ["Qd", "Ts"] },
  { pot: 80, bet: 80, value: 22, bluff: 8, stack: 180, board: ["Jc", "5d", "2s", "9h", "3c"], hand: ["Jh", "8d"] },
  { pot: 36, bet: 18, value: 9, bluff: 6, stack: 100, board: ["9s", "6d", "2c", "Kh", "4s"], hand: ["9d", "7c"] },
  { pot: 100, bet: 75, value: 14, bluff: 4, stack: 200, board: ["Td", "9c", "4s", "Jh", "2d"], hand: ["Tc", "8c"] },
  { pot: 24, bet: 24, value: 8, bluff: 5, stack: 100, board: ["8c", "3d", "2h", "As", "5c"], hand: ["8s", "6d"] },
  { pot: 45, bet: 90, value: 12, bluff: 6, stack: 160, board: ["6h", "6s", "Qd", "2c", "9d"], hand: ["Ac", "6c"] },
  { pot: 70, bet: 35, value: 11, bluff: 9, stack: 140, board: ["5c", "4d", "Ah", "9s", "2h"], hand: ["5d", "3s"] },
  { pot: 55, bet: 55, value: 16, bluff: 7, stack: 110, board: ["4s", "3c", "Kd", "8h", "2d"], hand: ["4h", "2s"] },
  { pot: 28, bet: 14, value: 6, bluff: 6, stack: 100, board: ["7c", "2d", "9h", "Qs", "3s"], hand: ["7d", "6s"] },
  { pot: 90, bet: 45, value: 15, bluff: 5, stack: 190, board: ["3h", "3d", "Ac", "8s", "5h"], hand: ["Kh", "3c"] },
];

const SPRS = [
  { stack: 100, pot: 10, board: ["Ac", "7d", "2s"], hand: ["Kd", "Qc"] },
  { stack: 150, pot: 15, board: ["Kh", "8c", "3d"], hand: ["Ah", "Jd"] },
  { stack: 200, pot: 8, board: ["Qs", "6d", "2c"], hand: ["Js", "Ts"] },
  { stack: 180, pot: 20, board: ["Jd", "5c", "4s"], hand: ["Ad", "Kd"] },
  { stack: 250, pot: 25, board: ["Td", "9s", "2h"], hand: ["Ah", "Th"] },
  { stack: 120, pot: 12, board: ["9c", "4d", "3s"], hand: ["Ac", "Qc"] },
  { stack: 160, pot: 16, board: ["8h", "7c", "2d"], hand: ["Kh", "Qh"] },
  { stack: 90, pot: 18, board: ["6s", "5d", "2c"], hand: ["As", "Ks"] },
];

const POTS = [
  { chips: [0.5, 2.5, 2.5, 2.5], chipText: "小盲 0.5 已棄，CO 2.5，按鈕 2.5，大盲補到 2.5", board: ["As", "8d", "3c"], hand: ["Kd", "Qd"], stack: 100 },
  { chips: [1, 3, 3], chipText: "大盲 1 已在底池，按鈕開到 3，大盲跟注再補 2，合計大盲 3、按鈕 3", board: ["Kh", "7c", "2d"], hand: ["Ah", "5h"], stack: 100 },
  { chips: [6, 4, 4], chipText: "翻牌前底池 6，你下注 4，對手跟注 4", board: ["Qc", "9d", "4s", "2h"], hand: ["Qh", "Jd"], stack: 140 },
  { chips: [10, 10, 20], chipText: "轉牌底池 10，對手下注 10，你加注到 30，也就是你再投入 20？不，本題籌碼是底池原有 10、對手下注 10、你只跟注 10", board: ["Jc", "8d", "3s", "2c"], hand: ["Jh", "Td"], stack: 160 },
];

function fixPotSpecs() {
  POTS[1] = { chips: [3, 3], chipText: "按鈕開到 3BB，大盲跟注後兩人各投入 3BB，小盲已棄且不計入這題", board: ["Kh", "7c", "2d"], hand: ["Ah", "5h"], stack: 100 };
  POTS[3] = { chips: [10, 10, 10], chipText: "轉牌開始底池 10，對手下注 10，你跟注 10", board: ["Jc", "8d", "3s", "2c"], hand: ["Jh", "Td"], stack: 160 };
}

const OUTS = [
  { outs: 15, street: "flop", board: ["7h", "6c", "2h"], hand: ["9h", "8h"], stack: 100 },
  { outs: 9, street: "turn", board: ["Js", "8s", "3d", "2c"], hand: ["As", "5s"], stack: 100 },
  { outs: 12, street: "flop", board: ["Ks", "7d", "3c"], hand: ["Qd", "Jd"], stack: 130 },
  { outs: 8, street: "turn", board: ["Ah", "9c", "4d", "2s"], hand: ["Kh", "Qh"], stack: 150 },
  { outs: 4, street: "flop", board: ["Qc", "8d", "3s"], hand: ["Jd", "Tc"], stack: 100 },
  { outs: 9, street: "flop", board: ["Td", "6c", "2d"], hand: ["Ad", "5d"], stack: 110 },
];

function buildQuestions() {
  fixPotSpecs();
  const byDate = new Map(DAY_META.map(([date, topic, focus, kind, count]) => [date, { date, topic, focus, kind, count, items: [] }]));
  for (const spec of STRATEGY) {
    const bucket = byDate.get(spec.date);
    const blind = bucket.kind === "test";
    const built = strategyQuestion(spec, bucket.items.length, blind);
    built.id = `p${spec.date.slice(8)}${bucket.items.length}`;
    built.order = bucket.items.length;
    bucket.items.push(built);
  }
  const queues = {
    flush: FLUSH_BOARDS.map((board, n) => ({ board, n })),
    pair: PAIR_BOARDS.map((item, n) => ({ ...item, n })),
    catch: CATCHES.map((item, n) => ({ ...item, n })),
    spr: SPRS.map((item, n) => ({ ...item, n })),
    pot: POTS.map((item, n) => ({ ...item, n })),
    outs: OUTS.map((item, n) => ({ ...item, n })),
  };
  const orderTypes = ["catch", "flush", "pair", "spr", "pot", "outs"];
  let cursor = 0;
  let synthN = 0;
  function synthBoard(seed) {
    const deck = [];
    for (const rank of "AKQJT98765432") {
      for (const suit of "shdc") deck.push(`${rank}${suit}`);
    }
    const board = [];
    let index = seed % deck.length;
    while (board.length < 5) {
      board.push(deck[index % deck.length]);
      index += 3;
    }
    return board;
  }
  function synthCatch(seed) {
    const board = synthBoard(seed + 17);
    const first = unused(board, ["As", "Kd", "Qc", "Jh", "Ts"]);
    const second = unused([...board, first], ["2c", "3d", "4h", "5s", "6c", "7d"]);
    return {
      pot: 22 + (seed % 8) * 6,
      bet: 11 + (seed % 5) * 7,
      value: 9 + (seed % 6),
      bluff: 4 + (seed % 5),
      stack: 110 + (seed % 7) * 15,
      board,
      hand: [first, second],
      n: seed,
    };
  }
  for (const [date, topic, focus, kind, count] of DAY_META) {
    const bucket = byDate.get(date);
    let guard = 0;
    while (bucket.items.length < count) {
      const type = orderTypes[cursor % orderTypes.length];
      cursor += 1;
      const spec = queues[type].shift() || (type === "catch" ? synthCatch(synthN++) : null);
      if (!spec) {
        guard += 1;
        if (guard > 30) throw new Error(`ran out of ${type} for ${date}`);
        continue;
      }
      const built = type === "catch" ? bluffcatch({ ...spec, id: `p${date.slice(5).replace("-", "")}${bucket.items.length}`, date, order: bucket.items.length, blind: kind === "test" })
        : type === "flush" ? flushQuestion({ ...spec, ...blockHand(spec.board), id: `p${date.slice(5).replace("-", "")}${bucket.items.length}`, date, order: bucket.items.length, blind: kind === "test", stack: 100 + bucket.items.length })
        : type === "pair" ? pairQuestion({ ...spec, id: `p${date.slice(5).replace("-", "")}${bucket.items.length}`, date, order: bucket.items.length, blind: kind === "test", stack: 100 })
        : type === "spr" ? sprQuestion({ ...spec, id: `p${date.slice(5).replace("-", "")}${bucket.items.length}`, date, order: bucket.items.length, blind: kind === "test" })
        : type === "pot" ? potQuestion({ ...spec, id: `p${date.slice(5).replace("-", "")}${bucket.items.length}`, date, order: bucket.items.length, blind: kind === "test" })
        : outsQuestion({ ...spec, id: `p${date.slice(5).replace("-", "")}${bucket.items.length}`, date, order: bucket.items.length, blind: kind === "test" });
      built.id = `p${date.slice(8)}${bucket.items.length}`;
      built.order = bucket.items.length;
      built.blind = kind === "test";
      if (kind === "light") built.tags = [...new Set([...built.tags, "pot-odds"])];
      bucket.items.push(built);
      guard = 0;
    }
  }
  const baselines = [
    strategyQuestion({
      date: "2026-11-08",
      tags: ["blockers"],
      board: ["Ah", "Kd", "7c", "3s", "2h"],
      hand: null,
      seats: "9", hero: "BB", villain: "BTN", stack: 100,
      extra: "基準題，不是今天的四題新情境。河牌按鈕滿池下注。本題假設：比較兩手抓詐唬牌時，要同時說出擋掉哪些價值、有沒有擋到詐唬。沒有「有阻擋牌就跟」的規則。A♥ 會擋到一些 Ax 價值，也擋到一些帶 A♥ 的沒中聽牌。",
      prompt: "基準：哪一句描述才對？",
      options: [
        { id: "a", text: "有阻擋牌就應該跟注" },
        { id: "b", text: "要分開看擋掉的價值和擋掉的詐唬，沒有絕對規則" },
      ],
      correctOptionId: "b",
      explanation: "阻擋牌會同時拿掉價值和詐唬裡用到那張牌的組合。只說有阻擋就跟，或只說有阻擋就棄，都不完整。",
    }, 0, false),
  ];
  baselines[0].id = "pbase-block";
  baselines[0].role = "baseline";
  baselines[0].date = "2026-11-08";
  const questions = [...baselines];
  const days = DAY_META.map(([date, topic, focus, kind, count]) => {
    const bucket = byDate.get(date);
    if (bucket.items.length !== count) throw new Error(`${date} has ${bucket.items.length}`);
    questions.push(...bucket.items);
    const monthDay = Number(date.slice(-2));
    return {
      date,
      day: monthDay,
      topic,
      focus,
      kind,
      minutes: 30,
      schedule: scheduleFor(kind),
      coreIds: bucket.items.map((item) => item.id),
      review: date === "2026-11-08" ? "baseline" : "prior-or-baseline",
    };
  });
  return { days, questions };
}

const BUILT = buildQuestions();
export const BOOT_DAYS = BUILT.days;
export const BOOT_QUESTIONS = BUILT.questions;

export function bootDay(date) {
  return BOOT_DAYS.find((day) => day.date === date) || null;
}

export function questionById(id) {
  return BOOT_QUESTIONS.find((question) => question.id === id) || null;
}

function latestKnown(attempts, questionId) {
  return attempts
    .filter((attempt) => attempt.questionId === questionId && attempt.correctnessStatus === "known" && attempt.source !== "legacy-pkt")
    .slice()
    .sort((left, right) => (left.submittedAt - right.submittedAt) || ((left.attemptNumber || 0) - (right.attemptNumber || 0)))
    .at(-1) || null;
}

export function dayCoreStatus(attempts, coreIds) {
  const done = coreIds.filter((id) => latestKnown(attempts, id));
  return { done: done.length, total: coreIds.length, complete: done.length === coreIds.length && coreIds.length > 0 };
}

export function freshAccuracy(attempts, questionIds) {
  const firsts = [];
  for (const id of questionIds) {
    const rows = attempts
      .filter((attempt) => attempt.questionId === id && attempt.correctnessStatus === "known" && attempt.attemptNumberStatus === "known")
      .slice()
      .sort((left, right) => (left.attemptNumber - right.attemptNumber) || (left.submittedAt - right.submittedAt));
    if (rows[0]) firsts.push(rows[0]);
  }
  const correct = firsts.filter((attempt) => attempt.correct).length;
  return { seen: firsts.length, correct, rate: firsts.length ? correct / firsts.length : null };
}

export function reviewChoice(questions, attempts, date) {
  if (date === "2026-11-08") return { questionId: "pbase-block", reason: "baseline" };
  const day = bootDay(date);
  const candidates = questions.filter((question) => question.role !== "baseline" && !day.coreIds.includes(question.id));
  const wrongs = candidates
    .map((question) => ({ question, latest: latestKnown(attempts, question.id) }))
    .filter((item) => item.latest && item.latest.correct === false);
  if (wrongs.length) {
    wrongs.sort((left, right) => (right.latest.submittedAt || 0) - (left.latest.submittedAt || 0));
    return { questionId: wrongs[0].question.id, reason: "prior-wrong" };
  }
  return { questionId: "pbase-block", reason: "baseline" };
}

export function deepestMiss(attempts, coreIds) {
  const misses = attempts.filter((attempt) => coreIds.includes(attempt.questionId) && attempt.correct === false && attempt.correctnessStatus === "known");
  if (!misses.length) return null;
  return misses.slice().sort((left, right) => (right.decisionTimeMs || 0) - (left.decisionTimeMs || 0) || (right.submittedAt || 0) - (left.submittedAt || 0))[0];
}

export function continueTarget(attempts, opens, today) {
  const open = Object.values(opens || {}).find((item) => BOOT_QUESTIONS.some((question) => question.id === item.questionId && question.role === "core"));
  if (open) return { type: "resume", questionId: open.questionId };
  const inRange = BOOT_DAYS.some((day) => day.date === today);
  const ordered = inRange ? [bootDay(today), ...BOOT_DAYS.filter((day) => day.date !== today)] : BOOT_DAYS;
  for (const day of ordered) {
    if (!dayCoreStatus(attempts, day.coreIds).complete) return { type: "day", date: day.date };
  }
  return { type: "done", date: BOOT_DAYS[0].date };
}
