import { analyze, measuredTimeForDay } from "./analytics.js";
import { h, clear } from "./dom.js";
import { correctnessLabel, decisionLabel, formatClock } from "./format.js";
import { migrateLegacy } from "./migrate.js";
import { orderOfDay, planDay, practiceQueue } from "./plan.js";
import { cardParts, renderAttempt } from "./render.js";
import { DAYS, GAME, QUESTIONS, TAGS } from "./questions.js";
import { questionById as foundationQuestion } from "./questions.js";
import {
  BOOT_DAYS,
  BOOT_QUESTIONS,
  PEDAGOGY_NOTE,
  TABLE_ASSUMPTION,
  bootDay,
  continueTarget,
  dayCoreStatus,
  deepestMiss,
  freshAccuracy,
  questionById as bootQuestion,
  reviewChoice,
} from "./bootcamp.js";
import {
  acceptStoredState,
  adoptState,
  createState,
  currentElapsed,
  endSession,
  enterQuestion,
  leaveQuestion,
  setConfidence,
  setDayNote,
  setReasoning,
  setSelection,
  setTableField,
  setVisible,
  snapshotForStorage,
  startSession,
  submitOpen,
  toggleExplicitPause,
} from "./session.js";
import { createStorage, STORAGE_KEYS } from "./storage.js";
import { syncStatus } from "./sync.js";
import { exportCsv, exportDocument, importDocument, parseImport } from "./transfer.js";

const storage = createStorage();
let historyCourse = "all";
let analyticsCourse = "all";

function questionById(id) {
  return bootQuestion(id) || foundationQuestion(id);
}

function allQuestions() {
  return [...QUESTIONS, ...BOOT_QUESTIONS];
}

function courseOf(attempt) {
  if (attempt.courseId) return attempt.courseId;
  if (attempt.source === "legacy-pkt" || String(attempt.questionId || "").startsWith("d")) return "foundation";
  if (String(attempt.questionId || "").startsWith("p")) return "bootcamp";
  return "other";
}

function filteredAttempts(course) {
  if (!course || course === "all") return state.attempts;
  return state.attempts.filter((attempt) => courseOf(attempt) === course);
}
const ERROR_TEXT = {
  NO_SELECTION: "請先選擇一個答案。",
  NO_OPEN_ATTEMPT: "這題沒有進行中的作答。",
  BAD_REASONING: "理由的格式不對。",
  REASONING_TOO_LONG: "理由請留在 2000 字以內。",
  BAD_CONFIDENCE: "信心請選 1 到 5，或留空。",
};
const DAY_MINUTES = 30 * 60 * 1000;

let state = createState(Date.now());
let saveStatus = { localStorage: "unknown", indexedDB: "unknown", lastSavedAt: null };
let activeQuestionId = null;
let tick = null;
let saveEpoch = 0;

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`;
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseRoute() {
  const hash = location.hash || "#/";
  const play = hash.match(/^#\/play\/([A-Za-z0-9._:-]+)$/);
  if (play) return { name: "play", id: play[1] };
  const day = hash.match(/^#\/day\/([123])$/);
  if (day) return { name: "day", day: Number(day[1]) };
  const boot = hash.match(/^#\/boot\/(2026-11-(?:0[8-9]|1\d|2[0-6]))$/);
  if (boot) return { name: "boot", date: boot[1] };
  const attempt = hash.match(/^#\/attempt\/([A-Za-z0-9._:-]+)$/);
  if (attempt) return { name: "attempt", id: attempt[1] };
  const question = hash.match(/^#\/question\/([A-Za-z0-9._:-]+)$/);
  if (question) return { name: "question", id: question[1] };
  if (hash === "#/history") return { name: "history" };
  if (hash === "#/analytics") return { name: "analytics" };
  if (hash === "#/transfer") return { name: "transfer" };
  return { name: "home" };
}

function knownFor(questionId) {
  return state.attempts
    .filter((attempt) => attempt.questionId === questionId && attempt.correctnessStatus === "known")
    .slice()
    .sort((left, right) => left.submittedAt - right.submittedAt || left.attemptNumber - right.attemptNumber);
}

function latestSession(day) {
  return [...state.sessions].reverse().find((session) => session.day === day && session.mode !== "legacy");
}

async function persist() {
  const epoch = ++saveEpoch;
  const snap = snapshotForStorage(state, Date.now());
  const status = await storage.save(snap, () => epoch === saveEpoch);
  if (epoch !== saveEpoch) return status;
  saveStatus = status;
  renderStatus();
  return status;
}

function stopTick() {
  if (tick) clearInterval(tick);
  tick = null;
}

function renderTimer() {
  const node = document.getElementById("decision-time");
  const label = document.getElementById("timer-state");
  if (!node || !activeQuestionId) return;
  const open = state.opens[activeQuestionId];
  if (!open) return;
  node.textContent = formatClock(currentElapsed(state, activeQuestionId, Date.now()));
  if (label) label.textContent = open.clock.runningSince != null ? "計時中" : "已暫停，這段不計入";
}

function tagLabel(tag) {
  return TAGS[tag]?.label || tag;
}

function cardRow(codes) {
  const row = h(document, "div", { class: "cards" });
  for (const code of codes || []) {
    const parts = cardParts(code);
    if (!parts) continue;
    row.append(h(document, "span", { class: `playing-card suit-${parts.suitClass}` }, [
      h(document, "b", { class: "rank" }, [parts.rank]),
      h(document, "span", { class: "suit" }, [parts.suit]),
    ]));
  }
  return row;
}

function renderBanner() {
  const banner = document.getElementById("banner");
  clear(banner);
  const sync = syncStatus();
  banner.append(h(document, "div", { class: "banner" }, [
    h(document, "strong", {}, ["儲存狀態"]),
    document.createTextNode(` ${sync.message}`),
  ]));
  if (state.meta.legacyImportedCount > 0) {
    banner.append(h(document, "div", { class: "banner" }, [
      `已保留舊進度 ${state.meta.legacyImportedCount} 筆。當時只存對或錯，沒有選項，也沒有作答時間。缺少的部分標成未知，沒有用現在的時鐘回推。`,
    ]));
  }
  if (state.meta.legacyError === "UNREADABLE") {
    banner.append(h(document, "div", { class: "banner warn" }, ["舊進度讀不出來，沒有寫入任何猜測。"]));
  }
  if ((state.meta.conflictArchive || []).length) {
    banner.append(h(document, "div", { class: "banner warn" }, [
      `有 ${state.meta.conflictArchive.length} 筆儲存內容不一致。兩份都留在匯出檔，沒有覆蓋。`,
    ]));
  }
  if (saveStatus.localStorage === "failed" && saveStatus.indexedDB === "failed") {
    banner.append(h(document, "div", { class: "banner warn" }, ["本機寫入失敗。剛送出的紀錄可能沒留下，請先匯出。"]));
  }
}

function renderStatus() {
  const footer = document.getElementById("status");
  clear(footer);
  const localText = saveStatus.localStorage === "ok" ? "localStorage 已寫入" : saveStatus.localStorage === "failed" ? "localStorage 失敗" : "localStorage 尚未寫入";
  const idbText = saveStatus.indexedDB === "ok" ? "IndexedDB 已寫入" : saveStatus.indexedDB === "failed" ? "IndexedDB 失敗" : "IndexedDB 未使用";
  const when = saveStatus.lastSavedAt ? `上次寫入 ${new Date(saveStatus.lastSavedAt).toLocaleString("zh-Hant")}` : "還沒有新的寫入";
  footer.append(h(document, "p", {}, [
    `${localText}。${idbText}。${when}。雲端同步：未連接。`,
  ]));
}

function render() {
  stopTick();
  renderBanner();
  renderStatus();
  const root = document.getElementById("app");
  clear(root);
  const route = parseRoute();
  if (route.name === "boot") renderBoot(root, route.date);
  else if (route.name === "day") renderDay(root, route.day);
  else if (route.name === "play") renderPlay(root, route.id);
  else if (route.name === "history") renderHistory(root);
  else if (route.name === "attempt") renderAttemptPage(root, route.id);
  else if (route.name === "question") renderQuestionPage(root, route.id);
  else if (route.name === "analytics") renderAnalytics(root);
  else if (route.name === "transfer") renderTransfer(root);
  else renderHome(root);
}

function progressOf(day) {
  const questions = QUESTIONS.filter((question) => question.day === day);
  const knownIds = new Set(questions.filter((question) => knownFor(question.id).length).map((question) => question.id));
  const correct = questions.filter((question) => knownFor(question.id).at(-1)?.correct).length;
  return { total: questions.length, done: knownIds.size, correct };
}

function courseFilters(which) {
  const current = which === "history" ? historyCourse : analyticsCourse;
  const row = h(document, "div", { class: "row" });
  for (const [id, label] of [["all", "全部"], ["bootcamp", "19 天課表"], ["foundation", "三天基本功"]]) {
    row.append(h(document, "button", {
      type: "button",
      "aria-pressed": current === id ? "true" : "false",
      onclick: () => {
        if (which === "history") historyCourse = id;
        else analyticsCourse = id;
        render();
      },
    }, [label]));
  }
  return row;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function renderBootcampHome(root) {
  const target = continueTarget(state.attempts, state.opens, todayKey());
  root.append(h(document, "p", { class: "eyebrow" }, ["2026/11/8–11/26"]));
  root.append(h(document, "h1", {}, ["濟州行前 19 天"]));
  root.append(h(document, "p", {}, [
    "對應 11/27–12/1 的現金局練習，盲注 KRW 10,000/20,000。每天約 30 分鐘，可以自己調整順序。沒做的日子保持未完成，不會被標成已錯過或已完成。",
  ]));
  root.append(h(document, "p", {}, [TABLE_ASSUMPTION]));
  root.append(h(document, "p", { class: "muted" }, [PEDAGOGY_NOTE]));
  root.append(h(document, "button", {
    class: "primary",
    type: "button",
    onclick: () => {
      if (target.type === "resume") openPractice(target.questionId);
      else location.hash = `#/boot/${target.date}`;
    },
  }, [target.type === "resume" ? "繼續未完成的題" : "開始今天或下一個未做完的日子"]));
  const list = h(document, "div", { class: "boot-list" });
  for (const day of BOOT_DAYS) {
    const status = dayCoreStatus(state.attempts, day.coreIds);
    list.append(h(document, "a", { class: "boot-day", href: `#/boot/${day.date}` }, [
      h(document, "strong", {}, [day.date.slice(5)]),
      h(document, "span", {}, [day.topic]),
      h(document, "span", {}, [`${status.done}/${status.total}`]),
    ]));
  }
  root.append(list);
}

function renderBoot(root, date) {
  const day = bootDay(date);
  root.append(h(document, "p", {}, [h(document, "a", { href: "#/" }, ["← 課表"])]));
  if (!day) {
    root.append(h(document, "p", {}, ["找不到這一天。"]));
    return;
  }
  const status = dayCoreStatus(state.attempts, day.coreIds);
  const review = reviewChoice(allQuestions(), state.attempts, date);
  root.append(h(document, "h1", {}, [`${date} ${day.topic}`]));
  root.append(h(document, "p", {}, [`新鮮題 ${status.done}/${status.total}。約 30 分鐘。`]));
  const plan = h(document, "ol");
  for (const block of day.schedule) plan.append(h(document, "li", {}, [`${block.minutes} 分鐘：${block.title}。${block.detail}`]));
  root.append(h(document, "section", { class: "panel" }, [h(document, "h2", {}, ["今天怎麼分配"]), plan]));
  const actions = h(document, "div", { class: "actions" });
  if (day.kind !== "test") {
    actions.append(h(document, "button", { type: "button", onclick: () => beginReview(date, review.questionId) }, [
      review.reason === "prior-wrong" ? "先複習一題真正答錯的（約 5 分鐘）" : "先做基準題（約 5 分鐘）",
    ]));
  }
  actions.append(h(document, "button", { class: "primary", type: "button", onclick: () => beginBoot(day) }, [
    status.done ? "繼續今天的新鮮題" : day.kind === "test" ? "開始六題測驗" : "開始今天的新題",
  ]));
  root.append(actions);
  const miss = deepestMiss(state.attempts, day.coreIds);
  const analysis = h(document, "section", { class: "panel" }, [h(document, "h2", {}, [day.kind === "light" ? "輕複習" : "最深的一題錯"])]);
  if (!miss) analysis.append(h(document, "p", {}, ["今天的新鮮題還沒有答錯。舊的三天紀錄不算進這裡，也不會編成一次失誤。答對但花比較久，也不算弱點。"]));
  else {
    const question = questionById(miss.questionId);
    analysis.append(h(document, "p", {}, [`${question ? question.prompt : miss.questionId}，決策時間 ${formatClock(miss.decisionTimeMs)}。`]));
    analysis.append(h(document, "a", { href: `#/question/${miss.questionId}` }, ["看這題的紀錄和講解"]));
  }
  root.append(analysis);
  if (day.kind === "test") {
    const fresh = freshAccuracy(state.attempts, day.coreIds);
    root.append(h(document, "p", {}, [`這天第一次作答 ${fresh.correct}/${fresh.seen}。${PEDAGOGY_NOTE}`]));
  }
  if (day.kind === "light") root.append(checklist());
  root.append(noteBox(date));
}

function beginBoot(day) {
  const sessionId = newId();
  state = startSession(state, {
    sessionId,
    day: day.day,
    mode: "boot-core",
    now: Date.now(),
    queue: day.coreIds,
    label: day.date,
    courseId: "bootcamp",
  });
  void persist();
  openPractice(day.coreIds[0]);
}

function beginReview(date, questionId) {
  state = startSession(state, {
    sessionId: newId(),
    day: Number(date.slice(-2)),
    mode: "boot-review",
    now: Date.now(),
    queue: [questionId],
    label: `${date} 複習`,
    courseId: "bootcamp",
  });
  void persist();
  openPractice(questionId);
}

function noteBox(date) {
  const box = h(document, "section", { class: "panel" }, [h(document, "h2", {}, ["一句話"])]);
  const area = h(document, "textarea", { maxlength: "500" });
  area.value = state.notes?.[date]?.text || "";
  area.addEventListener("change", () => {
    state = setDayNote(state, date, area.value, Date.now());
    void persist();
  });
  box.append(area);
  return box;
}

function checklist() {
  const box = h(document, "section", { class: "panel" }, [
    h(document, "h2", {}, ["上桌清單"]),
    h(document, "p", {}, ["买入是這次要拿到桌上的籌碼。虧損上限是這趟願意停下來的金額。兩件是不同的事。留空就保持空白，不會代填，也不會送出這台瀏覽器。"]),
    h(document, "p", {}, ["不要借錢加碼，不要輸了再把上限調高，也不要把單次买入自動變成這趟的虧損上限。"]),
  ]);
  box.append(tableField("這次买入", "buyInText"));
  box.append(tableField("這趟虧損上限", "lossCapText"));
  return box;
}

function tableField(label, field) {
  const wrap = h(document, "label", {}, [label]);
  const input = h(document, "input", { type: "text", maxlength: "40" });
  input.value = state.settings?.[field] || "";
  input.placeholder = "留空";
  input.addEventListener("change", () => {
    state = setTableField(state, field, input.value, Date.now());
    void persist();
  });
  wrap.append(input);
  return wrap;
}

function renderHome(root) {
  renderBootcampHome(root);
  root.append(h(document, "h1", {}, ["原本的三天基本功"]));
  root.append(h(document, "p", {}, [
    `${GAME}。每天約 30 分鐘，送出後立刻看講解。決策時間只算到第一次送出，暫停、離開頁面和讀講解都不計。`,
  ]));
  const grid = h(document, "div", { class: "day-grid" });
  for (const day of DAYS) {
    const progress = progressOf(day.day);
    const card = h(document, "article", { class: "day-card" }, [
      h(document, "h2", {}, [day.title]),
      h(document, "div", { class: "bar" }, [h(document, "i", { style: `width:${progress.total ? (progress.done / progress.total) * 100 : 0}%` })]),
      h(document, "p", { class: "muted" }, [`新紀錄 ${progress.done}/${progress.total}，最近一次答對 ${progress.correct}`]),
      h(document, "a", { class: "primary", href: `#/day/${day.day}` }, ["進入這一天"]),
    ]);
    grid.append(card);
  }
  root.append(grid);
  root.append(h(document, "p", { class: "muted" }, [
    "題幹裡的「單挑」是這手牌只剩兩個人，牌局仍是 6-max 現金局。舊版只留下對錯的題，會建議重做，但不會被當成這版的錯題。",
  ]));
}

function renderDay(root, day) {
  const info = DAYS.find((item) => item.day === day);
  const plan = planDay(QUESTIONS, state.attempts, day);
  const spent = measuredTimeForDay(state.attempts, day, Date.now(), dayKey);
  root.append(h(document, "p", {}, [h(document, "a", { href: "#/" }, ["← 課表"])]));
  root.append(h(document, "h1", {}, [info.title]));
  root.append(h(document, "p", {}, [
    `今天的決策時間 ${formatClock(spent)} / 約 ${formatClock(DAY_MINUTES)}。超過也可以繼續，講解時間不算在裡面。`,
  ]));
  const actions = h(document, "div", { class: "actions" }, [
    h(document, "button", { class: "primary", type: "button", onclick: () => beginDay(day, "records") }, [
      plan.playlist.length ? "依紀錄開始（先錯題，再沒做過的）" : "這天的新紀錄最近一次都答對",
    ]),
    h(document, "button", { type: "button", onclick: () => beginDay(day, "order") }, ["照題號把 12 題做完"]),
  ]);
  root.append(actions);
  root.append(sectionList("最近答錯，優先再做", plan.wrong));
  root.append(sectionList("舊版做過，但沒有選項，建議重做", plan.legacyOnly));
  root.append(sectionList("還沒有新紀錄", plan.unseen));
  root.append(sectionList("最近一次答對", plan.mastered));
}

function sectionList(title, questions) {
  const panel = h(document, "section", { class: "panel" }, [h(document, "h2", {}, [title])]);
  if (!questions.length) {
    panel.append(h(document, "p", { class: "muted" }, ["沒有"]));
    return panel;
  }
  const list = h(document, "ul");
  for (const question of questions) {
    list.append(h(document, "li", {}, [
      h(document, "a", { href: `#/question/${question.id}` }, [`${question.id} ${question.prompt}`]),
    ]));
  }
  panel.append(list);
  return panel;
}

function beginDay(day, mode) {
  const queue = practiceQueue(QUESTIONS, state.attempts, day, mode);
  if (!queue.length) return;
  const sessionId = newId();
  state = startSession(state, { sessionId, day, mode, now: Date.now(), queue });
  void persist();
  openPractice(queue[0]);
}

function openPractice(questionId) {
  sessionStorage.setItem("pkt-fresh", questionId);
  if ((location.hash || "") === `#/play/${questionId}`) render();
  else location.hash = `#/play/${questionId}`;
}

function renderPlay(root, questionId) {
  const question = questionById(questionId);
  if (!question) {
    root.append(h(document, "p", {}, ["找不到這題。"]));
    return;
  }
  const fresh = sessionStorage.getItem("pkt-fresh") === questionId;
  if (fresh) sessionStorage.removeItem("pkt-fresh");
  let open = state.opens[questionId];
  const known = knownFor(questionId);
  if (!open && (fresh || known.length === 0)) {
    const session = latestSession(question.day);
    const entered = enterQuestion(state, {
      question,
      sessionId: session?.sessionId || "practice-free",
      now: Date.now(),
      openId: newId(),
    });
    state = entered.state;
    open = state.opens[questionId];
    void persist();
  } else if (open) {
    const entered = enterQuestion(state, {
      question,
      sessionId: open.sessionId,
      now: Date.now(),
      openId: open.openId,
    });
    state = entered.state;
    open = state.opens[questionId];
  }
  const backHref = question.courseId === "bootcamp" ? `#/boot/${question.date}` : `#/day/${question.day}`;
  root.append(h(document, "p", {}, [h(document, "a", { href: backHref }, [question.courseId === "bootcamp" ? "← 這一天的課表" : "← 這一天"])]));
  if (!open) {
    activeQuestionId = null;
    const latest = known.at(-1);
    root.append(h(document, "h1", {}, ["這題已經送出"]));
    root.append(h(document, "p", {}, ["決策時間在送出時固定，閱讀下面的講解不會計入。"]));
    if (latest) root.append(renderAttempt(document, latest, question));
    root.append(h(document, "div", { class: "actions" }, [
      h(document, "button", { class: "primary", type: "button", onclick: () => openPractice(question.id) }, ["再做一次，另記一筆"]),
      h(document, "button", { type: "button", onclick: () => nextQuestion(question) }, ["下一題"]),
    ]));
    return;
  }
  activeQuestionId = questionId;
  const prior = known.length;
  const topic = question.blind ? "混合測驗，送出後才顯示主題" : question.tags.map(tagLabel).join("、");
  const place = question.date || `第 ${question.day} 天`;
  root.append(h(document, "p", { class: "eyebrow" }, [`${place} · 第 ${prior + 1} 次 · ${topic}`]));
  root.append(h(document, "div", { class: "timer" }, [
    h(document, "div", {}, [
      h(document, "div", { id: "timer-state" }, [open.clock.runningSince != null ? "計時中" : "已暫停，這段不計入"]),
      h(document, "strong", { id: "decision-time", "aria-live": "polite" }, [formatClock(currentElapsed(state, questionId, Date.now()))]),
    ]),
    h(document, "button", {
      id: "pause-timer",
      type: "button",
      onclick: () => {
        state = toggleExplicitPause(state, questionId, Date.now());
        renderTimer();
        const button = document.getElementById("pause-timer");
        if (button) button.textContent = state.opens[questionId].clock.explicit ? "繼續計時" : "暫停";
        void persist();
      },
    }, [open.clock.explicit ? "繼續計時" : "暫停"]),
  ]));
  root.append(h(document, "p", { class: "muted" }, ["從這題出現算到第一次送出。暫停、切到別的分頁、回到課表、以及送出後讀講解，都不計入。"]));
  const card = h(document, "article", { class: "question-card" }, [
    h(document, "p", {}, [question.spot]),
  ]);
  if (question.board.length) {
    const felt = h(document, "div", { class: "felt" }, [h(document, "p", {}, ["公共牌"])]);
    felt.append(cardRow(question.board));
    if (question.hand) {
      felt.append(h(document, "p", {}, ["你的手牌"]));
      felt.append(cardRow(question.hand));
    }
    card.append(felt);
  }
  card.append(h(document, "h1", {}, [question.prompt]));
  const options = h(document, "div", { class: "stack", role: "group", "aria-label": "選項" });
  for (const option of question.options) {
    options.append(h(document, "button", {
      class: "option",
      type: "button",
      "aria-pressed": open.selectedOptionId === option.id ? "true" : "false",
      onclick: () => {
        state = setSelection(state, questionId, option.id).state;
        render();
      },
    }, [`${option.id.toUpperCase()}. ${option.text}`]));
  }
  card.append(options);
  card.append(h(document, "label", { for: "reasoning" }, ["理由（可空白）"]));
  const reasoning = h(document, "textarea", { id: "reasoning", maxlength: "2000" }, []);
  reasoning.value = open.reasoning || "";
  reasoning.addEventListener("input", () => {
    const result = setReasoning(state, questionId, reasoning.value);
    if (!result.error) state = result.state;
  });
  reasoning.addEventListener("blur", () => { void persist(); });
  card.append(reasoning);
  card.append(h(document, "p", {}, ["信心（可空白）"]));
  const confidence = h(document, "div", { class: "row" });
  for (let value = 1; value <= 5; value += 1) {
    confidence.append(h(document, "button", {
      type: "button",
      "aria-pressed": open.confidence === value ? "true" : "false",
      onclick: () => {
        const next = open.confidence === value ? null : value;
        const result = setConfidence(state, questionId, next);
        if (!result.error) state = result.state;
        render();
      },
    }, [String(value)]));
  }
  card.append(confidence);
  card.append(h(document, "p", { id: "form-error", class: "bad" }, [""]));
  card.append(h(document, "button", {
    id: "submit-answer",
    class: "primary",
    type: "button",
    onclick: (event) => { void onSubmit(question, open.openId, event.currentTarget); },
  }, ["送出答案"]));
  root.append(card);
  tick = setInterval(renderTimer, 200);
}

async function onSubmit(question, openId, button) {
  button.disabled = true;
  const result = submitOpen(state, {
    questionId: question.id,
    openId,
    now: Date.now(),
    question,
    tagInfo: TAGS,
    attemptId: newId(),
  });
  if (result.error) {
    button.disabled = false;
    const error = document.getElementById("form-error");
    if (error) error.textContent = ERROR_TEXT[result.error] || "沒有送出";
    return;
  }
  state = result.state;
  activeQuestionId = null;
  stopTick();
  await persist();
  render();
}

function nextQuestion(question) {
  const session = [...state.sessions].reverse().find((item) => item.queue?.includes(question.id)) || latestSession(question.day);
  const queue = session?.queue?.length ? session.queue : orderOfDay(QUESTIONS, question.day);
  const next = queue[queue.indexOf(question.id) + 1];
  if (next) openPractice(next);
  else {
    if (session) state = endSession(state, session.sessionId, Date.now());
    void persist();
    location.hash = question.courseId === "bootcamp" ? `#/boot/${question.date}` : `#/day/${question.day}`;
  }
}

function renderHistory(root) {
  root.append(h(document, "h1", {}, ["作答紀錄"]));
  root.append(courseFilters("history"));
  const visible = filteredAttempts(historyCourse);
  if (!visible.length) {
    root.append(h(document, "p", {}, ["還沒有紀錄。做完一題就會留在這台瀏覽器。"]));
    return;
  }
  const groups = new Map();
  for (const session of state.sessions) groups.set(session.sessionId, { session, attempts: [] });
  for (const attempt of visible) {
    if (!groups.has(attempt.sessionId)) {
      groups.set(attempt.sessionId, {
        session: { sessionId: attempt.sessionId, label: attempt.source === "legacy-pkt" ? "舊版進度" : "場次", timestampStatus: "unknown" },
        attempts: [],
      });
    }
    groups.get(attempt.sessionId).attempts.push(attempt);
  }
  for (const group of groups.values()) {
    if (!group.attempts.length) continue;
    const title = group.session.label || (group.session.day ? `第 ${group.session.day} 天` : "場次");
    const when = group.session.startedAt ? new Date(group.session.startedAt).toLocaleString("zh-Hant") : "時間未知";
    const panel = h(document, "section", { class: "panel" }, [
      h(document, "h2", {}, [title]),
      h(document, "p", { class: "muted" }, [when]),
    ]);
    const table = h(document, "table", {}, [
      h(document, "tr", {}, ["題目", "結果", "決策時間"].map((text) => h(document, "th", {}, [text]))),
    ]);
    const rows = [...group.attempts].reverse();
    for (const attempt of rows) {
      table.append(h(document, "tr", {}, [
        h(document, "td", {}, [h(document, "a", { href: `#/attempt/${attempt.attemptId}` }, [attempt.questionId])]),
        h(document, "td", {}, [correctnessLabel(attempt)]),
        h(document, "td", {}, [decisionLabel(attempt).replace("決策時間：", "")]),
      ]));
    }
    panel.append(table);
    root.append(panel);
  }
}

function renderAttemptPage(root, attemptId) {
  const attempt = state.attempts.find((item) => item.attemptId === attemptId);
  root.append(h(document, "p", {}, [h(document, "a", { href: "#/history" }, ["← 紀錄"])]));
  if (!attempt) {
    root.append(h(document, "p", {}, ["找不到這筆紀錄。"]));
    return;
  }
  root.append(h(document, "h1", {}, ["單筆作答"]));
  root.append(renderAttempt(document, attempt, questionById(attempt.questionId)));
  root.append(h(document, "p", {}, [
    h(document, "a", { href: `#/question/${attempt.questionId}` }, ["看這一題的全部紀錄"]),
  ]));
}

function renderQuestionPage(root, questionId) {
  const question = questionById(questionId);
  root.append(h(document, "p", {}, [h(document, "a", { href: "#/history" }, ["← 紀錄"])]));
  if (!question) {
    root.append(h(document, "h1", {}, ["題目沒有對上目前題庫"]));
    const orphans = state.attempts.filter((attempt) => attempt.questionId === questionId);
    if (!orphans.length) root.append(h(document, "p", {}, ["找不到。"]));
    for (const attempt of orphans) root.append(renderAttempt(document, attempt, null));
    return;
  }
  root.append(h(document, "h1", {}, [question.prompt]));
  root.append(h(document, "p", { class: "note" }, ["下面先列每次作答自己的快照。最後一段才是目前題庫，兩者不一定相同。"]));
  const attempts = state.attempts.filter((attempt) => attempt.questionId === questionId).slice().reverse();
  if (!attempts.length) root.append(h(document, "p", {}, ["這一題還沒有紀錄。"]));
  for (const attempt of attempts) root.append(renderAttempt(document, attempt, question));
  const current = h(document, "section", { class: "panel" }, [
    h(document, "h2", {}, ["目前題庫版本"]),
    h(document, "p", {}, [question.spot]),
    h(document, "p", {}, [question.explanation]),
  ]);
  root.append(current);
  root.append(h(document, "button", { class: "primary", type: "button", onclick: () => openPractice(question.id) }, ["做這一題"]));
}

function renderAnalytics(root) {
  const pool = analyticsCourse === "bootcamp"
    ? BOOT_QUESTIONS
    : analyticsCourse === "foundation"
      ? QUESTIONS
      : allQuestions();
  const report = analyze(filteredAttempts(analyticsCourse), pool, { dayKey });
  root.append(courseFilters("analytics"));
  root.append(h(document, "h1", {}, ["弱點和時間"]));
  root.append(h(document, "p", {}, [
    "答錯才記入弱點。決策偏慢但答對的題會另外列出，不會自動變成弱點。舊版只有對錯、沒有選項的紀錄不混進下面的正確率。",
  ]));
  const accuracy = report.knownAttempts ? Math.round((report.knownCorrect / report.knownAttempts) * 100) : null;
  const stats = h(document, "div", { class: "stat-grid" }, [
    stat("新紀錄", `${report.knownCorrect}/${report.knownAttempts}`),
    stat("正確率", accuracy == null ? "尚無" : `${accuracy}%`),
    stat("決策時間中位數", report.medianMs == null ? "尚無" : formatClock(report.medianMs)),
  ]);
  root.append(stats);
  root.append(h(document, "p", { class: "muted" }, [
    `舊版標記答對 ${report.legacyMarkedCorrect}、答錯 ${report.legacyMarkedIncorrect}。時間未知 ${report.unknownTimeCount} 筆。`,
  ]));
  const table = h(document, "table", {}, [
    h(document, "tr", {}, ["項目", "類型", "新紀錄", "答錯"].map((text) => h(document, "th", {}, [text]))),
  ]);
  for (const [tag, info] of Object.entries(TAGS)) {
    const row = report.byTag[tag] || { attempts: 0, misses: 0 };
    table.append(h(document, "tr", {}, [
      h(document, "td", {}, [info.label]),
      h(document, "td", {}, [info.kind === "weakness" ? "弱點" : info.kind === "strength" ? "強項" : "課題"]),
      h(document, "td", {}, [String(row.attempts)]),
      h(document, "td", {}, [String(row.misses)]),
    ]));
  }
  root.append(h(document, "section", { class: "panel" }, [h(document, "h2", {}, ["分項"]), table]));
  root.append(linkList("優先複習：最近一次答錯", report.urgent, (item) => item.alsoSlow ? "答錯，而且這次偏慢" : "答錯"));
  root.append(linkList("決策偏慢但答對", report.slowCorrect, () => "不計入弱點"));
  const trend = h(document, "div", { class: "trend" });
  for (const bucket of report.trend) {
    const height = bucket.total ? Math.max(8, Math.round((bucket.correct / bucket.total) * 80)) : 8;
    trend.append(h(document, "span", { style: `height:${height}px`, title: `${bucket.key} ${bucket.correct}/${bucket.total}` }));
  }
  root.append(h(document, "section", { class: "panel" }, [
    h(document, "h2", {}, ["按日正確率"]),
    report.trend.length ? trend : h(document, "p", { class: "muted" }, ["還沒有帶時間戳的新紀錄。"]),
  ]));
  if (report.slowCutMs != null) {
    root.append(h(document, "p", { class: "muted" }, [
      `偏慢的門檻是中位數的 1.5 倍，且至少比中位數多 15 秒。目前是 ${formatClock(report.slowCutMs)}，樣本 ${report.sampleSize} 筆。樣本少於 4 筆時不標慢。`,
    ]));
  }
}

function stat(label, value) {
  return h(document, "article", { class: "day-card" }, [
    h(document, "p", { class: "eyebrow" }, [label]),
    h(document, "h2", {}, [value]),
  ]);
}

function linkList(title, items, detail) {
  const panel = h(document, "section", { class: "panel" }, [h(document, "h2", {}, [title])]);
  if (!items.length) {
    panel.append(h(document, "p", { class: "muted" }, ["沒有"]));
    return panel;
  }
  const list = h(document, "ul");
  for (const item of items) {
    const question = questionById(item.questionId);
    list.append(h(document, "li", {}, [
      h(document, "a", { href: `#/question/${item.questionId}` }, [question ? question.prompt : item.questionId]),
      document.createTextNode(` ${detail(item)}`),
    ]));
  }
  panel.append(list);
  return panel;
}

function renderTransfer(root) {
  root.append(h(document, "h1", {}, ["匯出與匯入"]));
  root.append(h(document, "p", {}, [
    "GitHub Pages 不能把紀錄寫進私人資料庫。自動同步目前未連接。要把紀錄交給助教，請下載 JSON，私下傳送。不要貼到公開 Issue、公開 Gist，也不要提交進這個公開倉庫。",
  ]));
  root.append(h(document, "div", { class: "actions" }, [
    h(document, "button", { class: "primary", type: "button", onclick: downloadJson }, ["下載 JSON 完整備份"]),
    h(document, "button", { type: "button", onclick: downloadCsv }, ["下載 CSV（沒有題目快照）"]),
  ]));
  root.append(h(document, "label", { for: "import-file" }, ["匯入 JSON 或 CSV"]));
  const file = h(document, "input", { id: "import-file", type: "file", accept: ".json,.csv,application/json,text/csv" });
  file.addEventListener("change", () => { void onImport(file.files?.[0]); });
  root.append(file);
  root.append(h(document, "div", { id: "import-result" }));
  root.append(h(document, "div", { class: "row" }, [
    h(document, "button", { type: "button", onclick: () => { void remigrate(); } }, ["再讀一次舊版進度"]),
    h(document, "button", { type: "button", onclick: clearRecords }, ["清除這台瀏覽器的新紀錄"]),
  ]));
  root.append(h(document, "p", { class: "muted" }, [
    "JSON 會保留每次作答的題目快照、選項、對錯、講解、時間和未完成的計時。CSV 給試算表用，匯入後快照會是未保存。同一編號如果內容不同，整份拒絕，避免蓋掉舊紀錄。",
  ]));
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = h(document, "a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJson() {
  const snap = snapshotForStorage(state, Date.now());
  download("poker-training-records.json", JSON.stringify(exportDocument(snap, new Date().toISOString()), null, 2), "application/json");
}

function downloadCsv() {
  download("poker-training-records.csv", exportCsv(state), "text/csv");
}

async function onImport(file) {
  const resultNode = document.getElementById("import-result");
  clear(resultNode);
  if (!file) return;
  const text = await file.text();
  const parsed = parseImport(text);
  if (!parsed.ok) {
    resultNode.append(h(document, "div", { class: "banner warn" }, [parsed.errors.map((error) => error.message).join("；")]));
    return;
  }
  const imported = importDocument(state, parsed.data);
  if (!imported.ok) {
    resultNode.append(h(document, "div", { class: "banner warn" }, [imported.errors.map((error) => error.message).join("；")]));
    return;
  }
  state = adoptState(imported.state);
  await persist();
  resultNode.append(h(document, "div", { class: "banner" }, [`匯入 ${imported.imported} 筆，略過相同的 ${imported.skipped} 筆。`]));
  renderBanner();
  renderStatus();
}

async function remigrate() {
  let raw = null;
  try {
    const text = localStorage.getItem(STORAGE_KEYS.legacy);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = [];
  }
  const result = migrateLegacy(state, raw, QUESTIONS, {
    now: Date.now(),
    force: true,
    attemptId: (key) => `legacypkt-${key}`,
  });
  state = adoptState(result.state);
  await persist();
  render();
}

function clearRecords() {
  const approved = window.confirm("清除這台瀏覽器裡的新紀錄？建議先下載 JSON。舊版鍵值 pkt 會留著，但不會自動再匯入。");
  if (!approved) return;
  const fresh = adoptState(createState(Date.now()));
  const next = structuredClone(fresh);
  next.meta.legacyMigrated = true;
  state = adoptState(next);
  void persist().then(render);
}

function onRoute() {
  const route = parseRoute();
  if (activeQuestionId && !(route.name === "play" && route.id === activeQuestionId)) {
    state = leaveQuestion(state, activeQuestionId, Date.now());
    activeQuestionId = null;
    void persist();
  }
  render();
}

async function boot() {
  const loaded = await storage.load();
  state = adoptState(loaded.state || createState(Date.now()));
  saveStatus = { ...loaded.status, lastSavedAt: state.meta?.updatedAt || null };
  if (!state.meta.legacyMigrated) {
    let raw = null;
    let unreadable = false;
    try {
      const text = localStorage.getItem(STORAGE_KEYS.legacy);
      if (text) raw = JSON.parse(text);
    } catch {
      unreadable = true;
    }
    if (unreadable) {
      const next = structuredClone(state);
      next.meta.legacyError = "UNREADABLE";
      state = adoptState(next);
    } else {
      const result = migrateLegacy(state, raw, QUESTIONS, {
        now: Date.now(),
        attemptId: (key) => `legacypkt-${key}`,
      });
      state = adoptState(result.state);
    }
  }
  const route = parseRoute();
  state = acceptStoredState(state, Date.now(), {
    visible: document.visibilityState !== "hidden",
    questionId: route.name === "play" ? route.id : null,
  });
  render();
  void persist();
  window.addEventListener("hashchange", onRoute);
  document.addEventListener("visibilitychange", () => {
    if (!activeQuestionId || !state.opens[activeQuestionId]) return;
    state = setVisible(state, activeQuestionId, document.visibilityState !== "hidden", Date.now());
    void persist();
    renderTimer();
  });
  window.addEventListener("pagehide", () => {
    saveEpoch += 1;
    storage.saveSync(snapshotForStorage(state, Date.now()));
  });
  setInterval(() => {
    if (Object.values(state.opens).some((open) => open.clock.runningSince != null)) void persist();
  }, 5000);
}

boot();
