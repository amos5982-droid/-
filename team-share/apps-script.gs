/* 카드뉴스 제작기 팀 공유: 발행 기록과 작업 원고를 이 구글 시트에 함께 둔다.
   시트의 확장 프로그램 → Apps Script에 붙여 넣고, 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자)으로 배포한다.
   앱에는 배포 주소(…/exec)와 팀 코드를 넣는다. 같은 팀 코드끼리만 같은 기록을 본다. */
var SHEET = '발행 기록';
var HEAD = ['팀 코드', '종류', '언어', '호', '발행일', '주제', '요약', '메모', '기록 시각'];
var DRAFT = '작업 원고';
var DHEAD = ['팀 코드', '종류', '언어', '고친 사람', '고친 시각(ms)', '고친 시각', '원고(JSON)'];

function sheet_() {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(SHEET);
  if (!s) {
    s = ss.insertSheet(SHEET);
    s.appendRow(HEAD);
    s.setFrozenRows(1);
    s.getRange('A:H').setNumberFormat('@'); // 발행일 같은 글자가 날짜로 바뀌지 않게
  }
  return s;
}
function draftSheet_() {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(DRAFT);
  if (!s) {
    s = ss.insertSheet(DRAFT);
    s.appendRow(DHEAD);
    s.setFrozenRows(1);
    s.getRange('A:G').setNumberFormat('@');
  }
  return s;
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function text_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v; // 수식으로 읽히지 않게
}

// 기록 읽기: ?code=팀코드 (원고는 &kind=draft)
function doGet(e) {
  var code = String((e && e.parameter && e.parameter.code) || '');
  if (!code) return out_({ok: false, error: 'code'});
  if (e.parameter.kind === 'draft') {
    var d = draftSheet_().getDataRange().getValues(), drafts = [];
    for (var n = 1; n < d.length; n++) {
      if (String(d[n][0]) !== code) continue;
      drafts.push({t: String(d[n][1]), l: String(d[n][2]), by: String(d[n][3]), at: Number(d[n][4]) || 0, json: String(d[n][6])});
    }
    return out_({ok: true, drafts: drafts});
  }
  var v = sheet_().getDataRange().getValues(), rows = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) !== code) continue;
    rows.push({t: String(v[i][1]), l: String(v[i][2]), no: v[i][3] === '' ? null : Number(v[i][3]),
      date: String(v[i][4]), subject: String(v[i][5]), summary: String(v[i][6]), text: String(v[i][7])});
  }
  return out_({ok: true, rows: rows});
}

// 기록 바꾸기: {code, ops:[{action:'upsert'|'delete'|'clear', t, l, e}]}
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var b = JSON.parse(e.postData.contents), code = String(b.code || '');
    if (!code) return out_({ok: false, error: 'code'});
    var s = sheet_();
    (b.ops || []).forEach(function (op) { apply_(s, code, op); });
    return out_({ok: true});
  } catch (err) {
    return out_({ok: false, error: String(err)});
  } finally {
    lock.releaseLock();
  }
}

function apply_(s, code, op) {
  if (op.action === 'draft') return draft_(code, op);
  var v = s.getDataRange().getValues(), e = op.e || {};
  var mine = function (r) { return String(r[0]) === code && String(r[1]) === op.t && String(r[2]) === op.l; };
  var same = function (r) { return e.no != null && e.no !== '' ? Number(r[3]) === Number(e.no) && r[3] !== '' : String(r[7]) === String(e.text || ''); };
  if (op.action === 'clear') {
    for (var i = v.length - 1; i >= 1; i--) if (mine(v[i])) s.deleteRow(i + 1);
  } else if (op.action === 'delete') {
    for (var j = v.length - 1; j >= 1; j--) if (mine(v[j]) && same(v[j])) s.deleteRow(j + 1);
  } else if (op.action === 'upsert') {
    var row = [code, op.t, op.l, e.no == null ? '' : e.no, text_(e.date), text_(e.subject), text_(e.summary), text_(e.text), new Date()];
    for (var k = 1; k < v.length; k++) {
      if (mine(v[k]) && same(v[k])) { s.getRange(k + 1, 1, 1, row.length).setValues([row]); return; }
    }
    s.appendRow(row);
  }
}

// 작업 원고: 종류와 언어마다 한 줄. 더 나중에 고친 것만 덮어쓴다
function draft_(code, op) {
  var s = draftSheet_(), v = s.getDataRange().getValues(), at = Number(op.at) || Date.now();
  var json = String(op.json || '');
  if (json.length > 49000) return; // 시트 칸 한도(5만 자) 안쪽만
  var row = [code, op.t, op.l, String(op.by || ''), String(at), Utilities.formatDate(new Date(at), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), json];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === code && String(v[i][1]) === op.t && String(v[i][2]) === op.l) {
      if ((Number(v[i][4]) || 0) > at) return;
      s.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  s.appendRow(row);
}
