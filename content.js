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

// CGPA Fetching Configuration
var CGPA_CONCURRENT_REQUESTS = 5; // Number of parallel requests
var cgpaCache = {}; // In-memory cache: { "jnf_id|com_id": { cgpa: "8.0", fetchedAt: timestamp } }
var isFetchingCGPA = false;
var cgpaFetchQueue = [];
var cgpaFetchProgress = { total: 0, completed: 0 };
var userCGPA = null; // User's CGPA for eligibility check

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
  // ERP now uses YYYY-MM-DD format instead of DD-MM-YYYY
  var parts = timeTextContent.split(/[- :]/);
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10) - 1; // Months are zero-based in JavaScript
  var day = parseInt(parts[2], 10);
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

// CGPA key for caching
function cgpaCacheKey(jnfId, comId) {
  return jnfId + '|' + comId;
}

// Extract jnf_id and com_id from onclick handler string
// e.g., TPJNFView("1","308","2025-2026") => { jnfId: "1", comId: "308", yop: "2025-2026" }
function parseTPJNFViewCall(onclickStr) {
  if (!onclickStr) return null;
  var match = onclickStr.match(/TPJNFView\s*\(\s*["'](\d+)["']\s*,\s*["'](\d+)["']\s*,\s*["']([^"']+)["']\s*\)/);
  if (!match) return null;
  return { jnfId: match[1], comId: match[2], yop: match[3] };
}

// Extract CGPA cutoff from TPJNFView.jsp HTML response
function parseCGPAFromHTML(html) {
  // Look for the CGPA Cut-off cell in the table
  // Structure: <td>CGPA Cut-off</td> in header, then value in data row
  var result = { cgpa: null, eligible: null, departments: [] };
  
  try {
    // Create a temporary DOM parser
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    
    // Check eligibility message
    var cells = doc.querySelectorAll('td');
    for (var i = 0; i < cells.length; i++) {
      var text = cells[i].textContent || '';
      if (text.indexOf('CGPA cut off greater than yours') !== -1) {
        result.eligible = false;
      } else if (text.indexOf('eligible') !== -1 && text.indexOf('not') === -1) {
        result.eligible = true;
      }
    }
    
    // Find CGPA Cut-off value - look for table with header "CGPA Cut-off"
    var tables = doc.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++) {
      var rows = tables[t].querySelectorAll('tr');
      var cgpaColIndex = -1;
      
      for (var r = 0; r < rows.length; r++) {
        var headerCells = rows[r].querySelectorAll('td, th');
        
        // Find which column has "CGPA Cut-off"
        for (var c = 0; c < headerCells.length; c++) {
          var cellText = (headerCells[c].textContent || '').trim();
          if (cellText === 'CGPA Cut-off' || cellText === 'CGPA Cutoff') {
            cgpaColIndex = c;
          }
        }
        
        // If we found the header, get the value from the next row
        if (cgpaColIndex !== -1 && r + 1 < rows.length) {
          var dataCells = rows[r + 1].querySelectorAll('td');
          if (dataCells[cgpaColIndex]) {
            var cgpaText = (dataCells[cgpaColIndex].textContent || '').trim();
            if (cgpaText && !isNaN(parseFloat(cgpaText))) {
              result.cgpa = cgpaText;
              break;
            }
          }
        }
      }
      if (result.cgpa) break;
    }
    
    // Fallback: regex search for CGPA pattern
    if (!result.cgpa) {
      var cgpaMatch = html.match(/CGPA[^<]*Cut[^<]*off[^<]*<\/td>\s*<\/tr>\s*<tr[^>]*>\s*(?:<td[^>]*>[^<]*<\/td>\s*)*<td[^>]*>([0-9.]+)<\/td>/i);
      if (cgpaMatch) {
        result.cgpa = cgpaMatch[1];
      }
    }
    
  } catch (e) {
    console.error('Error parsing CGPA HTML:', e);
  }
  
  return result;
}

// Fetch CGPA for a single company/role
function fetchCGPAForCompany(jnfId, comId, yop, rollno) {
  return new Promise(function(resolve, reject) {
    var cacheKey = cgpaCacheKey(jnfId, comId);
    
    // Check memory cache first - permanent cache, no expiration
    if (cgpaCache[cacheKey] && cgpaCache[cacheKey].cgpa) {
      resolve(cgpaCache[cacheKey]);
      return;
    }
    
    var url = 'https://erp.iitkgp.ac.in/TrainingPlacementSSO/TPJNFView.jsp' +
              '?jnf_id=' + encodeURIComponent(jnfId) +
              '&com_id=' + encodeURIComponent(comId) +
              '&yop=' + encodeURIComponent(yop || '2025-2026') +
              '&user_type=SU' +
              '&rollno=' + encodeURIComponent(rollno || '');
    
    fetch(url, { credentials: 'include' })
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function(html) {
        var parsed = parseCGPAFromHTML(html);
        var result = {
          jnfId: jnfId,
          comId: comId,
          cgpa: parsed.cgpa,
          eligible: parsed.eligible,
          fetchedAt: Date.now()
        };
        cgpaCache[cacheKey] = result;
        resolve(result);
      })
      .catch(function(err) {
        console.error('Failed to fetch CGPA for', jnfId, comId, err);
        resolve({ jnfId: jnfId, comId: comId, cgpa: null, eligible: null, fetchedAt: Date.now(), error: true });
      });
  });
}

// Batch fetch CGPA with concurrency control
function fetchCGPABatch(items, rollno, onProgress) {
  return new Promise(function(resolve) {
    if (!items || items.length === 0) {
      resolve([]);
      return;
    }
    
    var results = [];
    var queue = items.slice();
    var activeCount = 0;
    var completed = 0;
    var total = items.length;
    
    function processNext() {
      while (activeCount < CGPA_CONCURRENT_REQUESTS && queue.length > 0) {
        var item = queue.shift();
        activeCount++;
        
        fetchCGPAForCompany(item.jnfId, item.comId, item.yop, rollno)
          .then(function(result) {
            results.push(result);
            activeCount--;
            completed++;
            
            if (typeof onProgress === 'function') {
              onProgress(Math.round((completed / total) * 100), completed, total);
            }
            
            if (queue.length > 0) {
              processNext();
            } else if (activeCount === 0) {
              resolve(results);
            }
          });
      }
    }
    
    processNext();
  });
}

// Extract jnf_id and com_id from all rows in the grid
function extractCGPAParamsFromGrid() {
  var params = [];
  var nowTs = Date.now();
  
  if (!targetFrame || !targetFrame.document) return params;
  
  // Try to get data from jqGrid
  try {
    var $ = targetFrame.jQuery || targetFrame.$;
    // Try different possible grid IDs
    var gridEl = $ ? ($('#grid37').length ? $('#grid37') : $('[id^="grid"]').first()) : null;
    if ($ && gridEl && gridEl.length) {
      var gridData = gridEl.jqGrid('getGridParam', 'data');
      if (gridData && gridData.length > 0) {
        for (var i = 0; i < gridData.length; i++) {
          var row = gridData[i];
          // Parse from designation onclick
          var desigHtml = row.designation || '';
          var parsed = parseTPJNFViewCall(desigHtml);
          if (parsed) {
            var isApplied = (row.apply || '').toUpperCase().indexOf('Y') !== -1;
            var deadlineStr = row.resumedeadline || '';
            var deadlineTime = NaN;
            if (deadlineStr) {
              var dt = getElementDateTimeFromText(deadlineStr);
              if (dt instanceof Date && !isNaN(dt.getTime())) {
                deadlineTime = dt.getTime();
              }
            }
            var bucket = isApplied ? 'APPLIED' : (isNaN(deadlineTime) || deadlineTime <= nowTs) ? 'MISSED' : 'OPEN';
            
            params.push({
              jnfId: parsed.jnfId,
              comId: parsed.comId,
              yop: parsed.yop,
              _gridIndex: i,
              company: extractTextFromHtml(row.companyname),
              role: extractTextFromHtml(row.designation),
              statusBucket: bucket,
              deadline: deadlineStr
            });
          }
        }
        return params;
      }
    }
  } catch (e) {
    console.error('Error extracting from jqGrid:', e);
  }
  
  // Fallback: parse from DOM
  var designationCells = targetFrame.document.querySelectorAll('td[aria-describedby$="_designation"]');
  for (var j = 0; j < designationCells.length; j++) {
    var cell = designationCells[j];
    var link = cell.querySelector('a[onclick]');
    if (link) {
      var onclick = link.getAttribute('onclick') || '';
      var parsed = parseTPJNFViewCall(onclick);
      if (parsed) {
        var row = cell.parentElement;
        var companyCell = row ? row.querySelector('td[aria-describedby$="_companyname"]') : null;
        var statusCell = row ? row.querySelector('td[aria-describedby$="_apply"]') : null;
        var deadlineCell = row ? row.querySelector('td[aria-describedby$="_resumedeadline"]') : null;
        
        var isApplied = statusCell && (statusCell.textContent || '').toUpperCase().indexOf('Y') !== -1;
        var deadlineStr = deadlineCell ? (deadlineCell.textContent || '').trim() : '';
        var deadlineTime = NaN;
        if (deadlineStr) {
          var dt = getElementDateTimeFromText(deadlineStr);
          if (dt instanceof Date && !isNaN(dt.getTime())) {
            deadlineTime = dt.getTime();
          }
        }
        var bucket = isApplied ? 'APPLIED' : (isNaN(deadlineTime) || deadlineTime <= nowTs) ? 'MISSED' : 'OPEN';
        
        params.push({
          jnfId: parsed.jnfId,
          comId: parsed.comId,
          yop: parsed.yop,
          company: companyCell ? (companyCell.textContent || '').trim() : '',
          role: (link.textContent || '').trim(),
          statusBucket: bucket,
          deadline: deadlineStr
        });
      }
    }
  }
  
  return params;
}

// Helper to extract text from HTML string
function extractTextFromHtml(html) {
  if (!html) return '';
  var match = html.match(/title=['"]([^'"]+)['"]/);
  if (match) return match[1];
  // Fallback: strip tags
  return html.replace(/<[^>]+>/g, '').trim();
}

// Get student roll number from the page
function getStudentRollNo() {
  try {
    // Try to find roll number in the welcome message
    var welcomeText = document.body.textContent || '';
    var match = welcomeText.match(/\((\d{2}[A-Z]{2}\d{5})\)/);
    if (match) return match[1];
    
    // Try from URL if available
    var urlMatch = window.location.href.match(/rollno=(\d{2}[A-Z]{2}\d{5})/i);
    if (urlMatch) return urlMatch[1];
  } catch (e) {}
  return '';
}

// Main function to fetch CGPA for OPEN companies only
function fetchCGPAForOpenCompanies(allCompanies, onProgress, onComplete) {
  if (isFetchingCGPA) {
    console.log('CGPA fetch already in progress');
    if (onComplete) onComplete([]);
    return;
  }
  
  isFetchingCGPA = true;
  var rollno = getStudentRollNo();
  
  // Extract CGPA params directly from grid - this has jnfId/comId and statusBucket
  var allParams = extractCGPAParamsFromGrid();
  
  console.log('CGPA fetch: Total params from grid:', allParams.length);
  
  // Filter to only OPEN companies that aren't already cached
  var openItems = [];
  
  for (var i = 0; i < allParams.length; i++) {
    var param = allParams[i];
    
    // Only fetch for OPEN companies
    if (param.statusBucket !== 'OPEN') continue;
    
    // Check if already cached
    var cacheKey = cgpaCacheKey(param.jnfId, param.comId);
    var cached = cgpaCache[cacheKey];
    if (cached && cached.cgpa) continue;
    
    openItems.push(param);
  }
  
  console.log('CGPA fetch: Found', openItems.length, 'OPEN companies to fetch (not cached)');
  
  if (openItems.length === 0) {
    isFetchingCGPA = false;
    // Still trigger recolor to show existing badges
    try { myFunction(); } catch (e) {}
    if (onComplete) onComplete([]);
    return;
  }
  
  cgpaFetchProgress = { total: openItems.length, completed: 0 };
  
  fetchCGPABatch(openItems, rollno, function(pct, done, total) {
    cgpaFetchProgress = { total: total, completed: done };
    if (onProgress) onProgress(pct, done, total);
    try {
      chrome.runtime.sendMessage({ type: 'CGPA_FETCH_PROGRESS', progress: pct, completed: done, total: total });
    } catch (e) {}
  }).then(function(results) {
    isFetchingCGPA = false;
    
    // Save to storage (permanent)
    saveCGPACacheToStorage();
    
    // Trigger recolor to show badges on table
    try { myFunction(); } catch (e) {}
    
    if (onComplete) onComplete(results);
  });
}

// Save CGPA cache to chrome.storage.local
function saveCGPACacheToStorage() {
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ 
        cgpaCache: cgpaCache,
        cgpaCacheUpdatedAt: Date.now()
      });
    }
  } catch (e) {}
}

// Load CGPA cache from storage on startup
function loadCGPACacheFromStorage() {
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['cgpaCache', 'cgpaCacheUpdatedAt', 'userCGPA'], function(data) {
        if (data && data.cgpaCache) {
          // Merge with existing cache, keeping newer entries
          var stored = data.cgpaCache;
          for (var key in stored) {
            if (!cgpaCache[key] || stored[key].fetchedAt > (cgpaCache[key].fetchedAt || 0)) {
              cgpaCache[key] = stored[key];
            }
          }
        }
        if (data && data.userCGPA) {
          userCGPA = parseFloat(data.userCGPA);
        }
      });
    }
  } catch (e) {}
}

// Initialize CGPA cache from storage
loadCGPACacheFromStorage();

// Listen for userCGPA updates from popup
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.userCGPA) {
      userCGPA = parseFloat(changes.userCGPA.newValue) || null;
    }
  });
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
  
  // Add eligibility badge for OPEN companies (show CGPA requirement)
  if (bucket === 'OPEN') {
    addEligibilityBadgeToRow(element);
  } else {
    // Remove badge for non-OPEN companies
    removeEligibilityBadgeFromRow(element);
  }
}

// Remove eligibility badge from a row
function removeEligibilityBadgeFromRow(deadlineCell) {
  if (!deadlineCell) return;
  var row = deadlineCell.parentElement;
  if (!row) return;
  
  var designationCell = row.querySelector('td[aria-describedby$="_designation"]');
  if (!designationCell) return;
  
  // Remove any existing badge
  var badges = designationCell.querySelectorAll('[id^="cgpa-badge-"]');
  for (var i = 0; i < badges.length; i++) {
    badges[i].remove();
  }
}

// Add eligibility badge to a row based on CGPA
function addEligibilityBadgeToRow(deadlineCell) {
  if (!deadlineCell) return;
  
  var row = deadlineCell.parentElement;
  if (!row) return;
  
  // Get the designation cell to extract jnf_id and com_id
  var designationCell = row.querySelector('td[aria-describedby$="_designation"]');
  if (!designationCell) return;
  
  var link = designationCell.querySelector('a[onclick]');
  if (!link) return;
  
  var onclick = link.getAttribute('onclick') || '';
  var parsed = parseTPJNFViewCall(onclick);
  if (!parsed) return;
  
  var cacheKey = cgpaCacheKey(parsed.jnfId, parsed.comId);
  var cached = cgpaCache[cacheKey];
  
  // Find or create badge container in the designation cell
  var badgeId = 'cgpa-badge-' + parsed.jnfId + '-' + parsed.comId;
  var existingBadge = designationCell.querySelector('#' + badgeId);
  
  if (!cached || !cached.cgpa) {
    // No CGPA data yet - remove badge if exists
    if (existingBadge) existingBadge.remove();
    return;
  }
  
  // Calculate eligibility
  var requiredCGPA = parseFloat(cached.cgpa);
  var isEligible = userCGPA ? (userCGPA >= requiredCGPA) : null;
  
  // Create or update badge
  if (!existingBadge) {
    existingBadge = targetFrame.document.createElement('span');
    existingBadge.id = badgeId;
    existingBadge.style.cssText = 'margin-right:6px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;display:inline-block;';
    // Insert at the beginning of the cell
    designationCell.insertBefore(existingBadge, designationCell.firstChild);
  }
  
  if (isEligible === true) {
    existingBadge.textContent = '✓ ' + cached.cgpa;
    existingBadge.style.backgroundColor = 'rgba(165,252,3,0.3)';
    existingBadge.style.color = '#4a7c00';
    existingBadge.title = 'You meet the CGPA requirement (' + cached.cgpa + ')';
  } else if (isEligible === false) {
    existingBadge.textContent = '✗ ' + cached.cgpa;
    existingBadge.style.backgroundColor = 'rgba(252,36,3,0.3)';
    existingBadge.style.color = '#8b0000';
    existingBadge.title = 'CGPA requirement: ' + cached.cgpa + ' (Your CGPA: ' + userCGPA + ')';
  } else {
    // No user CGPA set
    existingBadge.textContent = 'CG: ' + cached.cgpa;
    existingBadge.style.backgroundColor = 'rgba(108,124,255,0.2)';
    existingBadge.style.color = '#4a5580';
    existingBadge.title = 'CGPA requirement: ' + cached.cgpa + ' (Set your CGPA in extension)';
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
        
        // Auto-fetch CGPA for OPEN companies after deep scan completes
        setTimeout(function() {
          fetchCGPAForOpenCompanies(list, function(pct, done, total) {
            try { chrome.runtime.sendMessage({ type: 'CGPA_FETCH_PROGRESS', progress: pct, completed: done, total: total }); } catch (e) {}
          }, function(results) {
            var updatedList = attachCGPAToCompanies(list);
            try {
              chrome.storage.local.set({ 
                allCompanies: updatedList,
                allCompaniesUpdatedAt: Date.now()
              });
              chrome.runtime.sendMessage({ 
                type: 'CGPA_FETCH_COMPLETE', 
                allCompanies: updatedList,
                cgpaResults: results 
              });
            } catch (e) {}
          });
        }, 500);
      }, function (pct) {
        try { chrome.runtime.sendMessage({ type: 'DEEP_SCAN_PROGRESS', progress: pct }); } catch (e) {}
      });
    } catch (e) {}
  }
  setTimeout(tryScan, 2000);
}
scheduleAutoDeepScan();

// Attach CGPA data to company list
function attachCGPAToCompanies(list) {
  var paramsMap = {};
  var allParams = extractCGPAParamsFromGrid();
  
  for (var i = 0; i < allParams.length; i++) {
    var key = (allParams[i].company + '|' + allParams[i].role).toLowerCase();
    paramsMap[key] = allParams[i];
  }
  
  for (var j = 0; j < list.length; j++) {
    var comp = list[j];
    var key = ((comp.company || '') + '|' + (comp.role || '')).toLowerCase();
    var params = paramsMap[key];
    
    if (params) {
      comp.jnfId = params.jnfId;
      comp.comId = params.comId;
      
      var cacheKey = cgpaCacheKey(params.jnfId, params.comId);
      var cached = cgpaCache[cacheKey];
      
      if (cached) {
        comp.cgpa = cached.cgpa;
        comp.cgpaEligible = cached.eligible;
        comp.cgpaFetchedAt = cached.fetchedAt;
      }
    }
  }
  
  return list;
}

// Respond to popup requests to get applied companies on demand
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'GET_APPLIED_COMPANIES' || msg.type === 'GET_COMPANIES') {
      var deep = !!msg.deep;
      var fetchCGPA = !!msg.fetchCGPA;
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
          
          // Attach CGPA data from cache
          list = attachCGPAToCompanies(list);
          
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
          
          // If requested, start CGPA fetch in background (prioritizing OPEN companies)
          if (fetchCGPA && !isFetchingCGPA) {
            setTimeout(function() {
              fetchCGPAForOpenCompanies(list, null, function(results) {
                // Re-attach CGPA and notify
                var updatedList = attachCGPAToCompanies(list);
                try {
                  chrome.runtime.sendMessage({ 
                    type: 'CGPA_FETCH_COMPLETE', 
                    allCompanies: updatedList,
                    cgpaResults: results 
                  });
                } catch (e) {}
              });
            }, 100);
          }
          
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
    
    // New message type: Fetch CGPA for companies
    if (msg.type === 'FETCH_CGPA') {
      try {
        if (!targetFrame || !targetFrame.document) {
          sendResponse({ success: false, error: 'No frame' });
          return true;
        }
        
        // Get current companies list
        var map = {};
        collectAllFromDOM(map);
        var list = Object.keys(map).map(function (k) { return map[k]; });
        
        fetchCGPAForOpenCompanies(list, function(pct, done, total) {
          try { chrome.runtime.sendMessage({ type: 'CGPA_FETCH_PROGRESS', progress: pct, completed: done, total: total }); } catch (e) {}
        }, function(results) {
          // Update storage with CGPA-enriched data
          var updatedList = attachCGPAToCompanies(list);
          try {
            chrome.storage.local.set({ 
              allCompanies: updatedList,
              allCompaniesUpdatedAt: Date.now()
            });
          } catch (e) {}
          try { 
            chrome.runtime.sendMessage({ 
              type: 'CGPA_FETCH_COMPLETE', 
              allCompanies: updatedList,
              cgpaResults: results 
            }); 
          } catch (e) {}
        });
        
        sendResponse({ success: true, message: 'CGPA fetch started' });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true;
    }
    
    // Get CGPA cache status
    if (msg.type === 'GET_CGPA_STATUS') {
      var cacheCount = Object.keys(cgpaCache).length;
      var hasData = cacheCount > 0;
      sendResponse({ 
        cacheCount: cacheCount, 
        hasData: hasData, 
        isFetching: isFetchingCGPA,
        progress: cgpaFetchProgress
      });
      return true;
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

