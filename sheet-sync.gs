/**
 * 커피 룰렛 – 구글 시트 동기화 백엔드 (Google Apps Script)
 *
 * 이 파일은 저장소에 보관용으로 들어있을 뿐, 웹앱(index.html)이 직접 읽지
 * 않습니다. 구글 시트의 [확장 프로그램 → Apps Script]에 이 내용을 붙여넣고
 * "웹 앱"으로 배포한 뒤, 배포 URL을 룰렛 앱의 "동기화" 창에 넣어 연결합니다.
 * 자세한 절차는 README.md의 "동료들과 당첨 기록 공유하기"를 참고하세요.
 *
 * 브라우저에서 바로 호출되기 때문에 두 가지 방식을 모두 받습니다.
 *  - GET  ...?p=<JSON>   (짧은 요청. CORS 사전 요청이 없어 가장 안전한 경로)
 *  - POST 본문에 <JSON>  (URL 길이 제한을 넘는 큰 요청용)
 * 어느 쪽이든 아래 handle()로 모여 같은 처리를 거칩니다.
 *
 * 모든 쓰기 요청은 처리 후 "전체 스냅샷"을 돌려줍니다. 앱이 한 번의 왕복으로
 * 내 변경과 동료의 변경을 함께 받아가므로 상태가 어긋나지 않습니다.
 */

const WINS_SHEET = "당첨기록";
const WINS_BACKUP_SHEET = "당첨기록_백업";
const ROSTER_SHEET = "명단";
const SETTINGS_SHEET = "설정";

const WINS_HEADER = ["시각", "카테고리", "이름"];
const ROSTER_HEADER = ["카테고리", "이름", "룰렛 포함"];
const SETTINGS_HEADER = ["키", "값"];

const TIME_FORMAT = "yyyy-mm-dd hh:mm";

function doGet(e) {
  return handle(e && e.parameter ? e.parameter.p : null);
}

function doPost(e) {
  return handle(e && e.postData ? e.postData.contents : null);
}

function handle(raw) {
  try {
    const request = raw ? JSON.parse(raw) : { action: "pull" };
    const action = request.action || "pull";

    // 읽기는 잠글 필요가 없습니다.
    if (action === "pull") return json(snapshot());

    // 여러 명이 동시에 룰렛을 돌려도 기록이 덮어써지지 않도록 직렬화합니다.
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (action === "win") appendWin(request);
      else if (action === "roster") writeRoster(request);
      else if (action === "push") replaceEverything(request);
      else if (action === "resetWins") moveWins(WINS_SHEET, WINS_BACKUP_SHEET);
      else if (action === "restoreWins") moveWins(WINS_BACKUP_SHEET, WINS_SHEET);
      else throw new Error("알 수 없는 action: " + action);
      return json(snapshot());
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ---------- 시트 접근 ----------

// 없는 탭은 헤더까지 갖춰서 자동으로 만들어 줍니다. 덕분에 사용자는 빈
// 스프레드시트 하나만 준비하면 되고, 탭 이름을 직접 맞출 필요가 없습니다.
function sheetNamed(name, header) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let target = book.getSheetByName(name);
  if (!target) {
    target = book.insertSheet(name);
    target.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
    target.setFrozenRows(1);
  }
  return target;
}

function dataRows(target, width) {
  const last = target.getLastRow();
  if (last < 2) return [];
  return target.getRange(2, 1, last - 1, width).getValues();
}

function clearBelowHeader(target, width) {
  const last = target.getLastRow();
  if (last < 2) return;
  const range = target.getRange(2, 1, last - 1, Math.max(width, target.getLastColumn()));
  range.clearContent();
  range.clearDataValidations();
}

// ---------- 읽기 ----------

function snapshot() {
  const wins = dataRows(sheetNamed(WINS_SHEET, WINS_HEADER), 3)
    .filter((row) => row[0] !== "" && String(row[2]).trim() !== "")
    .map((row) => [toMillis(row[0]), String(row[1]).trim(), String(row[2]).trim()])
    .filter((row) => isFinite(row[0]));

  // 이름이 비어 있는 줄은 "항목이 하나도 없는 카테고리"를 뜻합니다.
  const roster = dataRows(sheetNamed(ROSTER_SHEET, ROSTER_HEADER), 3)
    .filter((row) => String(row[0]).trim() !== "")
    .map((row) => [String(row[0]).trim(), String(row[1]).trim(), isTruthy(row[2])]);

  const settings = {};
  dataRows(sheetNamed(SETTINGS_SHEET, SETTINGS_HEADER), 2).forEach((row) => {
    settings[String(row[0]).trim()] = String(row[1]);
  });

  const backup = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WINS_BACKUP_SHEET);

  return {
    ok: true,
    wins: wins,
    roster: roster,
    title: settings["제목"] || "",
    subtitle: settings["부제목"] || "",
    hasBackup: !!backup && backup.getLastRow() > 1,
  };
}

// 시트 칸은 날짜 객체일 수도, 사람이 손으로 적은 문자열일 수도 있습니다.
function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const asNumber = Number(value);
  if (isFinite(asNumber) && asNumber > 0) return asNumber;
  return new Date(value).getTime();
}

// 체크박스는 불리언으로 오지만, 손으로 적은 "FALSE"/"N"/"0"도 존중합니다.
function isTruthy(value) {
  if (value === "" || value === null || value === undefined) return true;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toUpperCase();
  return text !== "FALSE" && text !== "N" && text !== "0" && text !== "NO";
}

// ---------- 쓰기 ----------

function appendWin(request) {
  const target = sheetNamed(WINS_SHEET, WINS_HEADER);
  const at = new Date(Number(request.at) || Date.now());
  target.appendRow([at, String(request.category || ""), String(request.name || "")]);
  target.getRange(target.getLastRow(), 1).setNumberFormat(TIME_FORMAT);
}

// 당첨기록은 "카테고리 + 이름"으로 사람을 가리키므로, 이름을 바꾸면 과거
// 기록이 옛 이름에 남아 끊깁니다. 명단을 새로 쓰기 전에 기록 쪽 이름도 함께
// 바꿔 이력이 계속 이어지게 합니다. fromName이 비어 있으면 "그 카테고리의
// 모든 줄"(= 카테고리 이름 자체가 바뀐 경우)을 뜻합니다.
function applyRenames(renames) {
  if (!renames || !renames.length) return;
  const book = SpreadsheetApp.getActiveSpreadsheet();

  [WINS_SHEET, WINS_BACKUP_SHEET].forEach((name) => {
    const target = book.getSheetByName(name);
    if (!target || target.getLastRow() < 2) return;

    const range = target.getRange(2, 2, target.getLastRow() - 1, 2); // 카테고리, 이름
    const values = range.getValues();
    let changed = false;

    values.forEach((row) => {
      renames.forEach((rename) => {
        const fromCategory = String(rename.fromCategory || "");
        const fromName = String(rename.fromName || "");
        if (String(row[0]).trim() !== fromCategory) return;
        if (fromName && String(row[1]).trim() !== fromName) return;
        row[0] = String(rename.toCategory || row[0]);
        if (fromName) row[1] = String(rename.toName || row[1]);
        changed = true;
      });
    });

    if (changed) range.setValues(values);
  });
}

function writeRoster(request) {
  applyRenames(request.renames);

  const target = sheetNamed(ROSTER_SHEET, ROSTER_HEADER);
  const rows = (request.roster || []).map((row) => [
    String(row[0] || ""),
    String(row[1] || ""),
    row[2] !== false,
  ]);

  clearBelowHeader(target, 3);
  if (rows.length) {
    target.getRange(2, 1, rows.length, 3).setValues(rows);
    target.getRange(2, 3, rows.length, 1).insertCheckboxes();
  }
  writeSettings(request);
}

function writeSettings(request) {
  const target = sheetNamed(SETTINGS_SHEET, SETTINGS_HEADER);
  clearBelowHeader(target, 2);
  target.getRange(2, 1, 2, 2).setValues([
    ["제목", String(request.title || "")],
    ["부제목", String(request.subtitle || "")],
  ]);
}

// 첫 연결 때 "이 기기 내용을 시트로 올리기"와, 백업 파일 가져오기에 쓰입니다.
function replaceEverything(request) {
  writeRoster(request);

  const target = sheetNamed(WINS_SHEET, WINS_HEADER);
  const rows = (request.wins || [])
    .filter((win) => isFinite(Number(win[0])))
    .map((win) => [new Date(Number(win[0])), String(win[1] || ""), String(win[2] || "")]);

  clearBelowHeader(target, 3);
  if (rows.length) {
    target.getRange(2, 1, rows.length, 3).setValues(rows);
    target.getRange(2, 1, rows.length, 1).setNumberFormat(TIME_FORMAT);
  }
}

// 초기화는 당첨기록 → 백업으로, 복구는 그 반대로 옮깁니다. 지우지 않고
// 옮기기만 하므로 실수로 초기화해도 되돌릴 수 있습니다.
function moveWins(fromName, toName) {
  const from = sheetNamed(fromName, WINS_HEADER);
  const to = sheetNamed(toName, WINS_HEADER);
  const rows = dataRows(from, 3);

  clearBelowHeader(to, 3);
  if (rows.length) {
    to.getRange(2, 1, rows.length, 3).setValues(rows);
    to.getRange(2, 1, rows.length, 1).setNumberFormat(TIME_FORMAT);
  }
  clearBelowHeader(from, 3);
}
