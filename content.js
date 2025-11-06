const frameName = "myframe"; // Replace with the name of your iframe
const targetFrame = window.frames[frameName]; //Access the frame by its name
var templateXPath = "/html/body/table/tbody/tr[3]/td/table/tbody/tr/td/table/tbody/tr/td/div[2]/div[3]/div[3]/div/table/tbody/tr[{number}]/td[12]";
const startNumber = 2;
const endNumber = 600;
const greenColor = '#a5fc03'; // applied (Y)
const yellowColor = '#ffea00'; // can still apply (open, not Y)
const redColor = '#fc2403'; // deadline over
const boxColor = '#cccccc';
var intervalID = setInterval(myFunction, 100);
var lastSaved = 0; // throttle storage saves
var isCrawling = false; // prevent concurrent deep scans

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

function collectAppliedFromDOM(intoMap) {
  var cells = targetFrame && targetFrame.document
    ? targetFrame.document.querySelectorAll('td[aria-describedby$="_resumedeadline"]')
    : [];
  for (var i = 0; i < cells.length; i++) {
    var info = extractRowInfoFromDeadlineCell(cells[i]);
    if (info && info.status.indexOf('Y') !== -1) {
      intoMap[uniqueKeyForRowInfo(info)] = info;
    }
  }
}

// Deep crawl: scroll the grid body to load all virtualized rows and collect applied companies
function deepCollectAppliedCompanies(done) {
  try {
    if (!targetFrame || !targetFrame.document) {
      done([]);
      return;
    }
    var bdiv = targetFrame.document.querySelector('.ui-jqgrid-bdiv');
    if (!bdiv) {
      var map = {};
      collectAppliedFromDOM(map);
      done(Object.keys(map).map(function (k) { return map[k]; }));
      return;
    }

    if (isCrawling) {
      // If already crawling, do a quick snapshot to avoid blocking
      var mapQuick = {};
      collectAppliedFromDOM(mapQuick);
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
        collectAppliedFromDOM(map);
        // If reached or very near bottom, finalize after one extra pass
        if (pos >= max - 5) {
          setTimeout(function () {
            try { collectAppliedFromDOM(map); } catch (e) {}
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
  var color;
  if (isApplied) {
    color = greenColor;
  } else if (isDeadlinePassed) {
    color = redColor;
  } else {
    color = yellowColor;
  }

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
    var appliedMap = {};
    for (var j = 0; j < deadlineCells.length; j++) {
      var cell = deadlineCells[j];
      var txt = cell && cell.textContent ? cell.textContent.trim() : '';
      if (!txt) { continue; }

      var dt = getElementDateTimeFromText(txt);
      if (!(dt instanceof Date) || isNaN(dt.getTime())) { continue; }

      var now = Date.now();
      changeColor(cell, dt, now);

      // Build applied companies list (Application Status = 'Y')
      var rowInfo = extractRowInfoFromDeadlineCell(cell);
      if (rowInfo && rowInfo.status.indexOf('Y') !== -1) {
        appliedMap[uniqueKeyForRowInfo(rowInfo)] = rowInfo;
      }
    }

    // Throttled persist to storage for popup consumption
    var nowTs = Date.now();
    if (nowTs - lastSaved > 1500 && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var appliedList = Object.keys(appliedMap).map(function (k) { return appliedMap[k]; });
      chrome.storage.local.set({ appliedCompanies: appliedList, appliedCompaniesUpdatedAt: nowTs });
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

// Respond to popup requests to get applied companies on demand
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'GET_APPLIED_COMPANIES') return; 
    var deep = !!msg.deep;
    try {
      if (!targetFrame || !targetFrame.document) {
        sendResponse({ appliedCompanies: [], appliedCompaniesUpdatedAt: Date.now() });
        return true;
      }

      var finalize = function(list) {
        var ts = Date.now();
        try {
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ appliedCompanies: list, appliedCompaniesUpdatedAt: ts });
          }
        } catch (e) {}
        try { sendResponse({ appliedCompanies: list, appliedCompaniesUpdatedAt: ts }); } catch (e) {}
      };

      if (deep) {
        deepCollectAppliedCompanies(function(list){ finalize(list); });
      } else {
        var map = {};
        collectAppliedFromDOM(map);
        var list = Object.keys(map).map(function (k) { return map[k]; });
        finalize(list);
      }
    } catch (e) {
      try { sendResponse({ appliedCompanies: [], appliedCompaniesUpdatedAt: Date.now(), error: String(e) }); } catch (ee) {}
    }
    return true; // keep message channel open for async sendResponse
  });
}


// Clear the interval after a certain time or condition
setTimeout(function () {
  clearInterval(intervalID);
}, 120000); // Stop after 120 seconds

