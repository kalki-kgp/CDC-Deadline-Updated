const frameName = "myframe"; // Replace with the name of your iframe
const targetFrame = window.frames[frameName]; //Access the frame by its name
var templateXPath = "/html/body/table/tbody/tr[3]/td/table/tbody/tr/td/table/tbody/tr/td/div[2]/div[3]/div[3]/div/table/tbody/tr[{number}]/td[12]";
const startNumber = 2;
const endNumber = 600;

// Colors are customizable via chrome.storage.local 'colors' key
var defaultColors = {
  applied: '#a5fc03', // green
  open: '#ffea00',    // yellow
  missed: '#fc2403',  // red
  box: '#cccccc'
};
var userColors = Object.assign({}, defaultColors);
function getColorForBucket(bucket) {
  if (bucket === 'APPLIED') return userColors.applied;
  if (bucket === 'OPEN') return userColors.open;
  if (bucket === 'MISSED') return userColors.missed;
  return userColors.box;
}
const boxColor = '#cccccc';
var intervalID = setInterval(myFunction, 100);
var lastSaved = 0; // throttle storage saves
var isCrawling = false; // prevent concurrent deep scans
var autoDeepScanScheduled = false;
var autoDeepScanAttempts = 0;

// Function to generate Xpath Expressions from template
function generateXPathExpressions(templateXPath, startNumber, endNumber) {
  var xpaths = [];

  for (var i = startNumber; i <= endNumber; i++) {
    var xpath = templateXPath.replace('{number}', i);
    xpaths.push(xpath.trim());
  }

  return xpaths;
}

// Get element date and time from text content 
function getElementDateTimeFromText(timeTextContent) {

  // Parse the time text and create a Date object
  var parts = timeTextContent.split(/[- :]/);
  var year = parseInt(parts[2], 10);
  var month = parseInt(parts[1], 10) - 1; // Months are zero-based in JavaScript
  var day = parseInt(parts[0], 10);
  var hour = parseInt(parts[3], 10);
  var minute = parseInt(parts[4], 10);
  var elementDateTime = new Date(year, month, day, hour, minute);
  return elementDateTime;
}

// selecting all the elements in which i want color change
function selectedElements(element) {
  var array = [];

  array.push(element); //current element (resumen upload end)
  var previousElement = element.previousElementSibling; 
  array.push(previousElement); // (resume upload start)
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // (Application status)
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // (Application Details)
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // (Application Details)
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // (Application Details)
  //previousElement = previousElement.previousElementSibling.previousElementSibling.previousElementSibling; 
  
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // Apply/Acceptance
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // Apply/Acceptance
  // previousElement = previousElement.previousElementSibling.previousElementSibling;
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // PPT
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // Additional Details
  previousElement = previousElement.previousElementSibling;
  array.push(previousElement); // Company
  previousElement = previousElement.previousElementSibling;

  return array;
}

// Load saved colors and update runtime
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  try {
    chrome.storage.local.get(['colors'], function (data) {
      if (data && data.colors) {
        try { userColors = Object.assign({}, defaultColors, data.colors || {}); } catch (e) {}
      }
    });
  } catch (e) {}
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.colors) {
        try { userColors = Object.assign({}, defaultColors, changes.colors.newValue || {}); } catch (e) {}
        // Recolor visible rows with new colors
        try { myFunction(); } catch (e) {}
      }
    });
  }
}

// Helpers to extract row details safely using aria-describedby suffixes found in ERP grid
function getRowCellBySuffix(row, suffix) {
  if (!row) return null;
  return row.querySelector('td[aria-describedby$="' + suffix + '"]');
}

function textContentOfCell(cell) {
  if (!cell) return '';
  return (cell.textContent || '').trim();
}

function extractRowInfoFromDeadlineCell(deadlineCell) {
  if (!deadlineCell) return null;
  var row = deadlineCell.parentElement;
  if (!row) return null;
  var companyCell = getRowCellBySuffix(row, '_companyname');
  var roleCell = getRowCellBySuffix(row, '_designation');
  var statusCell = getRowCellBySuffix(row, '_apply');
  var ctcCell = getRowCellBySuffix(row, '_ctc');
  var startCell = getRowCellBySuffix(row, '_resumedeadline_st');
  var endCell = getRowCellBySuffix(row, '_resumedeadline');

  var companyLink = companyCell ? companyCell.querySelector('a') : null;

  return {
    company: textContentOfCell(companyCell),
    role: textContentOfCell(roleCell),
    status: textContentOfCell(statusCell).toUpperCase(),
    ctc: textContentOfCell(ctcCell),
    deadlineStart: textContentOfCell(startCell),
    deadlineEnd: textContentOfCell(endCell),
    companyHref: companyLink ? companyLink.getAttribute('href') : ''
  };
}

function uniqueKeyForRowInfo(info) {
  return [info.company, info.role, info.deadlineEnd].join('|');
}

function computeBucket(isApplied, deadlineTime, nowTs) {
  if (isApplied) return 'APPLIED';
  if (isNaN(deadlineTime)) return 'UNKNOWN';
  return (deadlineTime <= nowTs) ? 'MISSED' : 'OPEN';
}

function collectAllFromDOM(intoMap) {
  var cells = targetFrame && targetFrame.document
    ? targetFrame.document.querySelectorAll('td[aria-describedby$="_resumedeadline"]')
    : [];
  for (var i = 0; i < cells.length; i++) {
    var info = extractRowInfoFromDeadlineCell(cells[i]);
    if (!info) continue;
    var nowTs = Date.now();
    var dt = getElementDateTimeFromText(info.deadlineEnd || '');
    var deadlineTime = (dt instanceof Date && !isNaN(dt.getTime())) ? dt.getTime() : NaN;
    var isApplied = (info.status || '').toUpperCase().indexOf('Y') !== -1;
    var bucket = computeBucket(isApplied, deadlineTime, nowTs);
    info.statusBucket = bucket;
    intoMap[uniqueKeyForRowInfo(info)] = info;
  }
}

// Deep crawl: scroll the grid body to load all virtualized rows and collect companies with buckets
function deepCollectAllCompanies(done, reportProgress) {
  try {
    if (!targetFrame || !targetFrame.document) {
      done([]);
      return;
    }
    var bdiv = targetFrame.document.querySelector('.ui-jqgrid-bdiv');
    if (!bdiv) {
      var map = {};
      collectAllFromDOM(map);
      done(Object.keys(map).map(function (k) { return map[k]; }));
      return;
    }

    if (isCrawling) {
      // If already crawling, do a quick snapshot to avoid blocking
      var mapQuick = {};
      collectAllFromDOM(mapQuick);
      done(Object.keys(mapQuick).map(function (k) { return mapQuick[k]; }));
      return;
    }

    isCrawling = true;
    var prevTop = bdiv.scrollTop;
    var map = {};
    var max = Math.max(0, bdiv.scrollHeight - bdiv.clientHeight);
    var step = Math.max(200, Math.floor(bdiv.clientHeight * 0.9));
    var pos = 0;

    // Start from top
    bdiv.scrollTop = 0;

    function stepFn() {
      try {
        collectAllFromDOM(map);
        if (typeof reportProgress === 'function') {
          try {
            var pct = max > 0 ? Math.min(100, Math.round((pos / max) * 100)) : 100;
            reportProgress(pct);
          } catch (e) {}
        }
        // If reached or very near bottom, finalize after one extra pass
        if (pos >= max - 5) {
          setTimeout(function () {
            try { collectAllFromDOM(map); } catch (e) {}
            // restore original scroll position
            bdiv.scrollTop = prevTop;
            isCrawling = false;
            done(Object.keys(map).map(function (k) { return map[k]; }));
          }, 220);
          return;
        }
        pos = Math.min(max, pos + step);
        bdiv.scrollTop = pos;
        setTimeout(stepFn, 180);
      } catch (e) {
        isCrawling = false;
        done(Object.keys(map).map(function (k) { return map[k]; }));
      }
    }

    setTimeout(stepFn, 120);
  } catch (e) {
    isCrawling = false;
    done([]);
  }
}

// Compare the two time values and change background color accordingly
function changeColor(element, elementDateTime, currentDateTime) {
  var changeColorElement = selectedElements(element);

  // Derive application status from the row. Based on current structure,
  // index 2 corresponds to "Application Status" (Y/N).
  var applicationStatusCell = changeColorElement[2];
  var statusText = applicationStatusCell && applicationStatusCell.textContent
    ? applicationStatusCell.textContent.trim().toUpperCase()
    : '';
  var isApplied = statusText === 'Y' || statusText.indexOf('Y') !== -1;

  var deadlineTime = (elementDateTime instanceof Date)
    ? elementDateTime.getTime()
    : Number(elementDateTime);

  var isDeadlinePassed = isNaN(deadlineTime) ? true : (deadlineTime <= currentDateTime);

  // Color priority per requirements:
  // - Green if applied (Y), regardless of deadline.
  // - Red if deadline is over and not applied.
  // - Yellow if deadline not over and not applied.
  var bucket = isApplied ? 'APPLIED' : (isDeadlinePassed ? 'MISSED' : 'OPEN');
  var color = getColorForBucket(bucket);

  for (var i = 0; i < changeColorElement.length; i++) {
    if (!changeColorElement[i]) continue;
    changeColorElement[i].style.backgroundColor = color;
    changeColorElement[i].style.borderColor = boxColor;
  }
}


// mainFunction

function myFunction() {

  // Ensure frame is available before trying to evaluate XPaths
  if (!targetFrame || !targetFrame.document) {
    return;
  }

  // Preferred: query by aria-describedby suffix to be robust to grid IDs
  var deadlineCells = targetFrame.document.querySelectorAll('td[aria-describedby$="_resumedeadline"]');

  if (deadlineCells && deadlineCells.length > 0) {
    var rowMap = {};
    for (var j = 0; j < deadlineCells.length; j++) {
      var cell = deadlineCells[j];
      var txt = cell && cell.textContent ? cell.textContent.trim() : '';
      if (!txt) { continue; }

      var dt = getElementDateTimeFromText(txt);
      if (!(dt instanceof Date) || isNaN(dt.getTime())) { continue; }

      var now = Date.now();
      changeColor(cell, dt, now);

      // Build companies snapshot with status bucket
      var rowInfo = extractRowInfoFromDeadlineCell(cell);
      if (rowInfo) {
        var isApplied = (rowInfo.status || '').toUpperCase().indexOf('Y') !== -1;
        var bucket = computeBucket(isApplied, dt.getTime(), now);
        rowInfo.statusBucket = bucket;
        rowMap[uniqueKeyForRowInfo(rowInfo)] = rowInfo;
      }
    }

    // Throttled persist to storage for popup consumption
    var nowTs = Date.now();
    if (nowTs - lastSaved > 1500 && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var allList = Object.keys(rowMap).map(function (k) { return rowMap[k]; });
      var counts = { applied: 0, open: 0, missed: 0 };
      for (var c = 0; c < allList.length; c++) {
        if (allList[c].statusBucket === 'APPLIED') counts.applied++;
        else if (allList[c].statusBucket === 'OPEN') counts.open++;
        else if (allList[c].statusBucket === 'MISSED') counts.missed++;
      }
      var appliedList = allList.filter(function (it) { return it.statusBucket === 'APPLIED'; });
      chrome.storage.local.set({
        appliedCompanies: appliedList,
        appliedCompaniesUpdatedAt: nowTs,
        allCompanies: allList,
        allCompaniesUpdatedAt: nowTs,
        statusCounts: counts
      });
      lastSaved = nowTs;
    }
  } else {
    // Fallback: use legacy XPath scanning if CSS lookup finds nothing
    var generatedXPaths = generateXPathExpressions(templateXPath, startNumber, endNumber);
    for (var i = 0; i < generatedXPaths.length; i++) {
      var xpath = generatedXPaths[i];
      var element = targetFrame.document.evaluate(xpath, targetFrame.document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!element) { continue; }
      var timeText = element.textContent;
      if (!timeText) { continue; }

      var elementDateTime = getElementDateTimeFromText(timeText);
      if (!(elementDateTime instanceof Date) || isNaN(elementDateTime.getTime())) { continue; }

      var currentDateTime = Date.now();
      changeColor(element, elementDateTime, currentDateTime);
    }
  }

} // Delay of 0.1 seconds (100 milliseconds)

// Auto-run a deep scan shortly after grid load, with a few retries
function scheduleAutoDeepScan() {
  if (autoDeepScanScheduled) return;
  autoDeepScanScheduled = true;
  function tryScan() {
    try {
      if (!targetFrame || !targetFrame.document || !targetFrame.document.querySelector('.ui-jqgrid-bdiv')) {
        autoDeepScanAttempts++;
        if (autoDeepScanAttempts < 10) {
          setTimeout(tryScan, 1500);
        }
        return;
      }
      deepCollectAllCompanies(function(list){
        var ts = Date.now();
        var counts = { applied: 0, open: 0, missed: 0 };
        for (var i=0;i<list.length;i++){
          var b = list[i].statusBucket;
          if (b === 'APPLIED') counts.applied++;
          else if (b === 'OPEN') counts.open++;
          else if (b === 'MISSED') counts.missed++;
        }
        try {
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
              allCompanies: list,
              allCompaniesUpdatedAt: ts,
              statusCounts: counts,
              appliedCompanies: list.filter(function (it) { return it.statusBucket === 'APPLIED'; }),
              appliedCompaniesUpdatedAt: ts
            });
          }
        } catch (e) {}
      }, function (pct) {
        try { chrome.runtime.sendMessage({ type: 'DEEP_SCAN_PROGRESS', progress: pct }); } catch (e) {}
      });
    } catch (e) {}
  }
  setTimeout(tryScan, 2000);
}
scheduleAutoDeepScan();

// Respond to popup requests to get applied companies on demand
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'GET_APPLIED_COMPANIES' || msg.type === 'GET_COMPANIES') {
      var deep = !!msg.deep;
      try {
        if (!targetFrame || !targetFrame.document) {
          sendResponse({ appliedCompanies: [], allCompanies: [], counts: { applied:0, open:0, missed:0 }, updatedAt: Date.now() });
          return true;
        }

        var finalize = function(list) {
          var ts = Date.now();
          var counts = { applied: 0, open: 0, missed: 0 };
          for (var i=0;i<list.length;i++){
            var b = list[i].statusBucket;
            if (b === 'APPLIED') counts.applied++;
            else if (b === 'OPEN') counts.open++;
            else if (b === 'MISSED') counts.missed++;
          }
          var appliedOnly = list.filter(function (it) { return it.statusBucket === 'APPLIED'; });
          try {
            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ 
                allCompanies: list,
                allCompaniesUpdatedAt: ts,
                statusCounts: counts,
                appliedCompanies: appliedOnly,
                appliedCompaniesUpdatedAt: ts
              });
            }
          } catch (e) {}
          try { sendResponse({ appliedCompanies: appliedOnly, allCompanies: list, counts: counts, updatedAt: ts }); } catch (e) {}
        };

        if (deep) {
          deepCollectAllCompanies(function(list){ finalize(list); }, function (pct) {
            try { chrome.runtime.sendMessage({ type: 'DEEP_SCAN_PROGRESS', progress: pct }); } catch (e) {}
          });
        } else {
          var map = {};
          collectAllFromDOM(map);
          var list = Object.keys(map).map(function (k) { return map[k]; });
          finalize(list);
        }
      } catch (e) {
        try { sendResponse({ appliedCompanies: [], allCompanies: [], counts: { applied:0, open:0, missed:0 }, updatedAt: Date.now(), error: String(e) }); } catch (ee) {}
      }
      return true; // keep message channel open for async sendResponse
    }
    if (msg.type === 'RECOLOR') {
      try { myFunction(); } catch (e) {}
      try { sendResponse({ ok: true }); } catch (e) {}
      return true;
    }
  });
}


// Clear the interval after a certain time or condition
setTimeout(function () {
  clearInterval(intervalID);
}, 120000); // Stop after 120 seconds

