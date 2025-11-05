// FILE: new_suggestions.js
// This file contains the specific logic for the New Suggestions page.

/**
 * Calculates a score for a suggestion based on how many systems have mappings.
 * @param {object} suggestion - The suggestion row object.
 * @returns {number} - A scor        const actionBadge = (untouchedAliasCount > 0 && (decisionObj.primary || isPrimaryRejected)) ? `<span class="ml-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">${untouchedAliasCount}</span>` : '';
        const popoverButtonId = `popover-btn-${safeIcdName}-${system}`;
        extraContentHtml = `<div class="mt-2 pt-2 border-t"><button id="${popoverButtonId}" onclick="showSuggestionsPopover(this, '${icdName}', '${system}')" class="popover-trigger w-full text-left text-xs font-semibold text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 flex items-center transition-colors"><i class="fa-solid fa-plus mr-2 text-xs"></i>+${otherSuggs.length} More Aliases ${actionBadge}</button></div>`;rom 0 to 3.
 */
function calculateMappingScore(suggestion) {
    let score = 0;
    if (suggestion.ayurveda_suggestions && suggestion.ayurveda_suggestions !== '[]') score++;
    if (suggestion.siddha_suggestions && suggestion.siddha_suggestions !== '[]') score++;
    if (suggestion.unani_suggestions && suggestion.unani_suggestions !== '[]') score++;
    return score;
}
// Add this new block at the top of new_suggestions.js

const DB_NAME = 'NamasteICD_DB';
const SUGGESTIONS_STORE_NAME = 'suggestions_cache';
const DB_VERSION = 3; // Incremented to force schema recreation

/**
 * Deletes the IndexedDB database to reset it.
 */
async function resetCacheDb() {
    try {
        console.log('🔄 Resetting IndexedDB database...');
        await idb.deleteDB(DB_NAME);
        console.log('✅ IndexedDB database reset successfully');
    } catch (err) {
        console.error('Failed to reset IndexedDB:', err);
    }
}

/**
 * Opens and initializes the IndexedDB database with error recovery.
 * This function sets up the necessary object stores for caching.
 * @returns {Promise<IDBDatabase>} A promise that resolves to the database instance.
 */
async function openCacheDb() {
    try {
        return await idb.openDB(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion, newVersion, transaction) {
                console.log(`📊 Upgrading IndexedDB from v${oldVersion} to v${newVersion}`);
                
                // If upgrading from an older version, delete old stores to avoid conflicts
                if (oldVersion > 0 && db.objectStoreNames.contains(SUGGESTIONS_STORE_NAME)) {
                    db.deleteObjectStore(SUGGESTIONS_STORE_NAME);
                    console.log('🗑️ Deleted old object store');
                }
                
                // Create fresh object store
                db.createObjectStore(SUGGESTIONS_STORE_NAME, { keyPath: 'suggested_icd_name' });
                console.log('✅ Created new object store');
            },
            blocked() {
                console.warn('⚠️ IndexedDB upgrade blocked. Please close other tabs.');
            },
            blocking() {
                console.warn('⚠️ This tab is blocking IndexedDB upgrade.');
            },
        });
    } catch (err) {
        console.error('❌ Failed to open IndexedDB, resetting database:', err);
        // If opening fails, reset and try again
        await resetCacheDb();
        return await idb.openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                db.createObjectStore(SUGGESTIONS_STORE_NAME, { keyPath: 'suggested_icd_name' });
            },
        });
    }
}
// Add this new function at the top of new_suggestions.js

/**
 * Retrieves suggestions data, prioritizing a local cache to improve performance.
 * If cached data is found, it's returned immediately. Otherwise, it fetches
 * from the API, stores the result in the cache for future use, and then returns it.
// Replace the old getSuggestionsWithCache with this new IndexedDB version

/**
 * Retrieves suggestions data, using IndexedDB as a high-capacity cache.
 * If the cache is populated, data is returned instantly. Otherwise, it fetches
 * from the API and populates the cache for future use.
 * @returns {Promise<Array>} A promise that resolves to the array of suggestions.
 */
async function getSuggestionsWithCache() {
    try {
        const db = await openCacheDb();
        
        // Try to get cached suggestions
        let cachedSuggestions;
        try {
            cachedSuggestions = await db.getAll(SUGGESTIONS_STORE_NAME);
        } catch (err) {
            console.warn('⚠️ Failed to read from cache, resetting:', err);
            await resetCacheDb();
            // Proceed to fetch from API below
            cachedSuggestions = [];
        }

        if (cachedSuggestions && cachedSuggestions.length > 0) {
            console.log("✅ Loading suggestions from IndexedDB cache.");
            return cachedSuggestions;
        }

        console.log("📡 IndexedDB cache empty. Fetching suggestions from API...");
        const suggestions = await fetchAPI('/admin/all-suggestions');

        // Store the fresh data in IndexedDB for next time.
        try {
            const tx = db.transaction(SUGGESTIONS_STORE_NAME, 'readwrite');
            await Promise.all(suggestions.map(item => tx.store.put(item)));
            await tx.done;
            console.log("✅ Suggestions cached in IndexedDB.");
        } catch (err) {
            console.warn('⚠️ Failed to cache suggestions:', err);
            // Continue anyway - we have the data from API
        }

        return suggestions;
    } catch (err) {
        console.error('❌ Cache system failed, falling back to direct API fetch:', err);
        // Complete fallback: just fetch from API without caching
        return await fetchAPI('/admin/all-suggestions');
    }
}

/*
// This function is called by shared.js after the DOM is ready and common data is loaded.
async function initializePage() {
    // Set the pagination limit to 500 items per page
    state.pagination.new.limit = 500;

    // Assign page-specific DOM elements
    Object.assign(dom, {
        rejectionModal: document.getElementById('rejection-modal'),
        rejectionReasonView: document.getElementById('rejection-reason-view'),
        rejectionUndoView: document.getElementById('rejection-undo-view'),
        validationModal: document.getElementById('validation-modal'),
        validationIssues: document.getElementById('validation-issues'),
        validationErrorView: document.getElementById('validation-error-view'),
        validationPromoteView: document.getElementById('validation-promote-view'),
        promotionMessage: document.getElementById('promotion-message'),
        confirmPromoteButton: document.getElementById('confirm-promote-button'),
    });

    try {
        const suggestions = await fetchAPI('/admin/all-suggestions');

        // Sort by mapping count (descending) then alphabetically
        suggestions.sort((a, b) => {
            const scoreA = calculateMappingScore(a);
            const scoreB = calculateMappingScore(b);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return a.suggested_icd_name.localeCompare(b.suggested_icd_name);
        });
        
        state.allSuggestionsCache = suggestions;
        state.filteredSuggestions = state.allSuggestionsCache;
        state.pagination.new.total = state.filteredSuggestions.length;
        
        renderNewSuggestions();
    } catch (error) {
        dom.contentArea.innerHTML = `<p class="p-8 text-red-500">Error loading suggestions: ${error.message}</p>`;
    } finally {
        dom.mainLoader.classList.add('hidden');
    }
}
*/

// Replace the old initializePage function with this one

async function initializePage() {
    // Set the pagination limit to 500 items per page
    state.pagination.new.limit = 50;

    // Assign page-specific DOM elements
    Object.assign(dom, {
        rejectionModal: document.getElementById('rejection-modal'),
        rejectionReasonView: document.getElementById('rejection-reason-view'),
        rejectionUndoView: document.getElementById('rejection-undo-view'),
        validationModal: document.getElementById('validation-modal'),
        validationIssues: document.getElementById('validation-issues'),
        validationErrorView: document.getElementById('validation-error-view'),
        validationPromoteView: document.getElementById('validation-promote-view'),
        promotionMessage: document.getElementById('promotion-message'),
        confirmPromoteButton: document.getElementById('confirm-promote-button'),
    });

    try {
        // --- MODIFICATION IS HERE ---
        // We now call our caching function instead of the raw API fetch.
        let suggestions;
        let bypassCache = false;
        try {
            const inv = Number(localStorage.getItem('suggestionsInvalidate')||'0');
            const lastLoad = Number(localStorage.getItem('suggestionsCacheLoadedAt')||'0');
            if(inv && inv > lastLoad){ bypassCache = true; }
        } catch {}
        if(bypassCache){
            try { await clearSuggestionsCache?.(); } catch {}
            suggestions = await fetchAPI('/admin/all-suggestions');
        } else {
            suggestions = await getSuggestionsWithCache();
        }
        try { localStorage.setItem('suggestionsCacheLoadedAt', String(Date.now())); } catch {}
        // Normalize AI justification so blanks / failures render as 'N/A' in UI
        try {
            if (Array.isArray(suggestions)) {
                const systems = ['ayurveda','siddha','unani'];
                for (const sug of suggestions) {
                    for (const sys of systems) {
                        const key = sys + '_suggestions';
                        if (!sug[key] || typeof sug[key] !== 'string' || sug[key] === '[]') continue;
                        try {
                            const arr = JSON.parse(sug[key]);
                            let changed = false;
                            for (const obj of arr) {
                                const j = (obj.ai_justification||'').trim();
                                if (!j || j === 'AI analysis failed' || j === 'AI enrichment failed' ) {
                                    obj.ai_justification = 'N/A';
                                    changed = true;
                                }
                            }
                            if (changed) sug[key] = JSON.stringify(arr);
                        } catch {}
                    }
                }
            }
        } catch (e) { console.warn('Justification normalization failed', e); }
        // If empty and a reset was just triggered, show hint and poll a few times
        const resetAt = Number(localStorage.getItem('curationResetAt') || '0');
        const recentlyReset = resetAt && (Date.now() - resetAt) < 5 * 60 * 1000; // 5 minutes
        const hintEl = document.getElementById('reset-hint');
        if (recentlyReset && Array.isArray(suggestions) && suggestions.length === 0) {
            if (hintEl) hintEl.classList.remove('hidden');
            // poll up to 6 times (every 10s) or until results arrive
            for (let i = 0; i < 6; i++) {
                await new Promise(r => setTimeout(r, 10000));
                // Force bypass of cache for this refresh
                try {
                    const fresh = await fetchAPI('/admin/all-suggestions');
                    if (Array.isArray(fresh) && fresh.length > 0) {
                        // Update cache for future loads
                        try {
                            const db = await openCacheDb();
                            const tx = db.transaction(SUGGESTIONS_STORE_NAME, 'readwrite');
                            await tx.store.clear();
                            await Promise.all(fresh.map(item => tx.store.put(item)));
                            await tx.done;
                        } catch {}
                        suggestions = fresh;
                        break;
                    }
                } catch {}
            }
        }
        // --- END OF MODIFICATION ---

        // Sort by mapping count (descending) then alphabetically
        suggestions.sort((a, b) => {
            const scoreA = calculateMappingScore(a);
            const scoreB = calculateMappingScore(b);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return a.suggested_icd_name.localeCompare(b.suggested_icd_name);
        });
        
        state.allSuggestionsCache = suggestions;
        state.filteredSuggestions = state.allSuggestionsCache;
        state.pagination.new.total = state.filteredSuggestions.length;
        
        renderNewSuggestions();
    } catch (error) {
        dom.contentArea.innerHTML = `<p class="p-8 text-red-500">Error loading suggestions: ${error.message}</p>`;
    } finally {
        dom.mainLoader.classList.add('hidden');
        // Clear the reset marker once we’ve attempted to load
        try { localStorage.removeItem('curationResetAt'); } catch {}
    }
}

// React to cross-tab invalidation while page is open
window.addEventListener('storage', async e => {
    if(e.key==='suggestionsInvalidate'){
        try {
            dom.mainLoader?.classList.remove('hidden');
            // Force refresh bypassing cache
            const fresh = await fetchAPI('/admin/all-suggestions');
            state.allSuggestionsCache = fresh;
            state.filteredSuggestions = fresh;
            state.pagination.new.total = fresh.length;
            renderNewSuggestions();
            showToast?.('Suggestions refreshed','info');
            try { localStorage.setItem('suggestionsCacheLoadedAt', String(Date.now())); } catch {}
        } catch(err){ console.warn('Live suggestions refresh failed', err); }
        finally { dom.mainLoader?.classList.add('hidden'); }
    }
});

// --- RENDERING FUNCTIONS ---

function renderNewSuggestions() {
    const searchBarHtml = `
        <div class="p-4 border-b relative">
            <input type="text" id="search-bar" onkeyup="handleSearch(this)" value="${state.searchTerm}" class="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Search by ICD-11 Name or Term (min. 3 chars)...">
            <div class="absolute right-24 top-1/2 -translate-y-1/2 flex items-center space-x-2">
                <button id="hl-prev" onclick="prevHighlight()" class="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled>Prev</button>
                <span id="hl-count" class="text-xs text-gray-500 select-none">0/0</span>
                <button id="hl-next" onclick="nextHighlight()" class="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled>Next</button>
            </div>
            <div id="search-loader" class="loader hidden" style="position: absolute; right: 25px; top: 25px;"></div>
        </div>`;
    const tableHeader = `<thead class="bg-gray-50"><tr class="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"><th class="table-cell w-1/4">Suggested ICD-11</th><th class="table-cell w-1/4">Ayurveda</th><th class="table-cell w-1/4">Siddha</th><th class="table-cell w-1/4">Unani</th></tr></thead>`;
    
    const shellHtml = `
        ${searchBarHtml}
        <div id="suggestions-pagination-top" class="p-4 flex justify-between items-center border-b"></div>
        <div class="overflow-x-auto">
            <table class="grid-table">${tableHeader}<tbody id="suggestions-tbody"></tbody></table>
        </div>
        <div id="suggestions-pagination" class="p-4 flex justify-between items-center border-t"></div>
    `;

    dom.contentArea.innerHTML = shellHtml;
    dom.suggestionsTbody = document.getElementById('suggestions-tbody');
    dom.suggestionsPagination = document.getElementById('suggestions-pagination');
    dom.suggestionsPaginationTop = document.getElementById('suggestions-pagination-top');
    updateNewSuggestionsContent();
}

function updateNewSuggestionsContent() {
    if (!dom.suggestionsTbody) return;
    const { page, limit, total } = state.pagination.new;
    const start = (page - 1) * limit;
    const paginatedItems = state.filteredSuggestions.slice(start, start + limit);
    const rows = paginatedItems.map(row => createNewSuggestionRow(row)).join('');
    dom.suggestionsTbody.innerHTML = rows || `<tr><td colspan="4" class="text-center py-12 text-gray-500">No suggestions match your search.</td></tr>`;
    renderPagination();
    // Update highlight matches for navigation
    if (!state.highlightNav) state.highlightNav = { matches: [], index: 0 };
    updateHighlightMatches();
}

function createNewSuggestionRow(row) {
    const icdName = row.suggested_icd_name;
    const safeIcdName = icdName.replace(/[^a-zA-Z0-9]/g, '-');
    const highlightedIcdName = highlightMatches(icdName, state.searchTerm);
    return `<tr><td class="table-cell font-medium text-sm text-gray-800">${highlightedIcdName}</td>${createCurationCell(safeIcdName,icdName,'ayurveda',row)}${createCurationCell(safeIcdName,icdName,'siddha',row)}${createCurationCell(safeIcdName,icdName,'unani',row)}</tr>`;
}

function createCurationCell(safeIcdName, icdName, system, row) {
    const systemDataString = row[`${system}_suggestions`];
    if (!systemDataString || systemDataString === '[]') return `<td class="table-cell text-gray-400 bg-gray-50 text-xs">N/A</td>`;
    let suggestions;
    try {
        suggestions = JSON.parse(systemDataString);
        if (!Array.isArray(suggestions) || suggestions.length === 0) return `<td class="table-cell text-gray-400 bg-gray-50 text-xs">N/A</td>`;
    } catch (e) { return `<td class="table-cell text-red-500 bg-red-100 text-xs">Data Error</td>`; }

    const decisionObj = state.curationDecisions[icdName]?.[system] || {};
    let cellClass = '';
    if (decisionObj.primary) cellClass = 'cell-approved';
    else if (decisionObj.review_suggestion) cellClass = 'cell-review';
    else if ((decisionObj.rejected_suggestions || []).some(r => r.isPrimary)) cellClass = 'cell-rejected';

    let primarySugg = null;
    const approvedPrimaryId = decisionObj.primary;
    const rejectedPrimaryInfo = (decisionObj.rejected_suggestions || []).find(r => r.isPrimary);
    const isPrimaryRejected = !!rejectedPrimaryInfo;

    if (approvedPrimaryId) primarySugg = suggestions.find(s => getSuggestionId(s) === approvedPrimaryId);
    else if (decisionObj.review_suggestion) primarySugg = suggestions.find(s => getSuggestionId(s) === decisionObj.review_suggestion);
    else if (rejectedPrimaryInfo) primarySugg = rejectedPrimaryInfo.suggestion;
    else primarySugg = suggestions.find(s => !(decisionObj.rejected_suggestions || []).some(r => getSuggestionId(r.suggestion) === getSuggestionId(s)));
    
    if (!primarySugg) return `<td class="table-cell cell-rejected text-xs" id="cell-${safeIcdName}-${system}">All suggestions handled.</td>`;

    const otherSuggs = suggestions.filter(s => getSuggestionId(s) !== getSuggestionId(primarySugg));
    const primaryHtml = renderSuggestion(primarySugg, icdName, system, 'primary');
    let extraContentHtml = '';

    if (otherSuggs.length > 0) {
        const untouchedAliasCount = otherSuggs.filter(s => {
            const sId = getSuggestionId(s);
            const isLinked = (decisionObj.aliases || []).includes(sId);
            const isRejected = (decisionObj.rejected_suggestions || []).some(r => getSuggestionId(r.suggestion) === sId);
            return !isLinked && !isRejected;
        }).length;
        const actionBadge = (untouchedAliasCount > 0 && (decisionObj.primary || isPrimaryRejected)) ? `<span class="ml-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">${untouchedAliasCount}</span>` : '';
        const popoverButtonId = `popover-btn-${safeIcdName}-${system}`;
        extraContentHtml = `<div class="mt-2 pt-2 border-t"><button id="${popoverButtonId}" onclick="showSuggestionsPopover(this, '${icdName}', '${system}')" class="popover-trigger w-full text-left text-xs font-semibold text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 flex items-center transition-colors"><i class="fa-solid fa-plus mr-2 text-xs"></i>+${otherSuggs.length} More Aliases ${actionBadge}</button></div>`;
    }

    // AUTO-PROMOTION pending badge (visual indicator) if: no explicit primary, at least one alias linked, original primary rejected (or implicitly removed), not all rejected, not review
    let autopromoteBadge='';
    try {
        const allSuggestions=suggestions;
        const hasPrimary=!!decisionObj.primary;
        const linkedAliases=(decisionObj.aliases||[]).filter(a=>a!==decisionObj.primary);
        const isPrimRejected=(decisionObj.rejected_suggestions||[]).some(r=>r.isPrimary);
        const allRejected = Array.isArray(allSuggestions) && allSuggestions.length>0 && ((decisionObj.rejected_suggestions||[]).length===allSuggestions.length);
        if(!hasPrimary && linkedAliases.length>0 && (isPrimRejected || !primarySugg) && !decisionObj.review_suggestion && !allRejected){
            autopromoteBadge = `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold" title="An alias will auto-promote to Primary on save">AUTO-PROMOTE</span>`;
        }
    }catch{}
    return `<td class="table-cell ${cellClass} text-xs" id="cell-${safeIcdName}-${system}">${primaryHtml}${autopromoteBadge}${extraContentHtml}</td>`;
}

function renderSuggestion(suggestion, icdName, system, type) {
    if (!suggestion) return '';
    const { term = 'N/A', code = 'N/A', devanagari, tamil, arabic, confidence = 0, source_description = 'N/A', source_short_definition = null, source_long_definition = null, justification = 'N/A', source_row = '?', origin = null, ingestion_filename = null } = suggestion;
    const suggestionId = getSuggestionId(suggestion);
    const decisionObj = state.curationDecisions[icdName]?.[system] || {};
    
    const highlightedTerm = highlightMatches(term, state.searchTerm);
    const highlightedVernacular = devanagari ? highlightMatches(devanagari, state.searchTerm) : (tamil ? highlightMatches(tamil, state.searchTerm) : (arabic ? highlightMatches(arabic, state.searchTerm) : ''));
    // Strict separation: do NOT fallback between short/long; show explicit messages when missing
    const shortDefText = (source_short_definition && String(source_short_definition).trim())
        ? source_short_definition
        : 'Short definition is not available in source file';
    const longDefText = (source_long_definition && String(source_long_definition).trim())
        ? source_long_definition
        : 'Long definition is not available in source file';
    const highlightedShort = highlightMatches(shortDefText, state.searchTerm);
    const highlightedLong = highlightMatches(longDefText, state.searchTerm);
    const highlightedJust = highlightMatches(justification, state.searchTerm);

    const isPrimary = decisionObj.primary === suggestionId;
    const isAlias = (decisionObj.aliases || []).includes(suggestionId);
    const rejectedInfo = (decisionObj.rejected_suggestions || []).find(r => getSuggestionId(r.suggestion) === suggestionId);
    const isRejected = !!rejectedInfo;
    const isReview = decisionObj.review_suggestion === suggestionId;

    const numericConfidence = parseInt(confidence, 10) || 0;
    let confColor = 'bg-gray-200 text-gray-800';
    if (numericConfidence >= 80) confColor = 'bg-green-100 text-green-800';
    else if (numericConfidence >= 50) confColor = 'bg-yellow-100 text-yellow-800';
    else if (numericConfidence > 0) confColor = 'bg-red-100 text-red-800';

    const actionButtonsHtml = (type === 'primary') ? `
        <button onclick="handleSetPrimary('${icdName}', '${system}', '${suggestionId}')" class="${isPrimary ? 'text-green-600' : 'text-gray-400'} hover:text-green-600 text-lg" title="Set as Primary"><i class="${isPrimary ? 'fa-solid' : 'fa-regular'} fa-circle-check"></i></button>
        <button onclick="handleSetReview('${icdName}', '${system}', '${suggestionId}')" class="${isReview ? 'text-orange-500' : 'text-gray-400'} hover:text-orange-500 text-lg" title="Mark for Review"><i class="${isReview ? 'fa-solid' : 'fa-regular'} fa-star"></i></button>
        <button onclick="handleReject('${icdName}', '${system}', '${suggestionId}', true)" class="${isRejected ? 'text-red-600' : 'text-gray-400'} hover:text-red-600 text-lg" title="${isRejected ? 'Undo Reject' : 'Reject'}"><i class="fa-solid fa-circle-xmark"></i></button>
    ` : `
        <button onclick="handlePromoteToPrimary('${icdName}', '${system}', '${suggestionId}')" class="text-xs font-semibold text-gray-500 hover:text-blue-600 p-1 rounded flex items-center" title="Make Primary"><i class="fa-solid fa-arrow-up-from-bracket mr-1"></i>Promote</button>
        <button onclick="handleAddAlias('${icdName}', '${system}', '${suggestionId}')" class="alias-button ${isAlias ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-indigo-600'} text-xs font-semibold p-1 rounded flex items-center" title="Add as Alias"><i class="fa-solid fa-link mr-1"></i>Link</button>
        <button onclick="handleReject('${icdName}', '${system}', '${suggestionId}', false)" class="${isRejected ? 'text-red-600' : 'text-gray-400'} hover:text-red-600 text-lg px-2" title="${isRejected ? 'Undo Reject' : 'Reject Alias'}"><i class="fa-solid fa-xmark"></i></button>
    `;

    const rejectionReasonHtml = (isRejected) ? `<p class="text-xs text-red-700 mt-1 font-semibold">Reason: ${(rejectedInfo.reason || 'N/A').replace('incorrect', 'Incorrect Mapping').replace('orphan', 'Orphaned')}</p>` : '';
    const containerClass = isAlias ? 'alias-approved' : (isRejected ? 'alias-rejected' : '');

    // Badge for ingested provenance
    const provenanceBadge = origin === 'ingestion' ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold" title="Ingested from file${ingestion_filename?`: ${ingestion_filename}`:''}">INGESTED</span>` : '';
    const sourceLineMeta = `<span class="font-mono lowercase text-gray-400">(line ${source_row}${ingestion_filename?` • ${ingestion_filename}`:''})</span>`;
    return `<div class="p-1 ${containerClass} rounded-md">
        <div class="flex justify-between items-start mb-1">
            <div>
                <p class="font-semibold text-sm flex items-center">${highlightedTerm}${provenanceBadge}</p>
                <p class="text-gray-500 text-sm">${highlightedVernacular}</p>
            </div>
            <span class="px-2 py-0.5 rounded-full text-xs font-medium ${confColor}">${confidence}%</span>
        </div>
        <p class="font-mono text-xs text-gray-500 mb-2">${code}</p>
        <div class="space-y-2 text-[11px]">
            <div class="border-t pt-2">
                <h4 class="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Source Short Def. ${sourceLineMeta}</h4>
                <p class="text-gray-600 break-words">${highlightedShort || ''}</p>
            </div>
            <div>
                <h4 class="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Source Long Def.</h4>
                <p class="text-gray-600 break-words">${highlightedLong || ''}</p>
            </div>
            <div>
                <h4 class="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">AI Justification</h4>
                <p class="text-gray-600 break-words">${highlightedJust}</p>
            </div>
        </div>
        ${rejectionReasonHtml}
        <div class="flex items-center justify-end mt-2 space-x-2 pt-2 border-t">${actionButtonsHtml}</div>
    </div>`;
}

// --- EVENT HANDLERS & LOGIC ---

function handleSearch(inputElement) {
    clearTimeout(state.searchTimeout);
    const searchLoader = document.getElementById('search-loader');
    if (searchLoader) searchLoader.classList.remove('hidden');

    state.searchTimeout = setTimeout(() => {
        state.searchTerm = inputElement.value;
        state.pagination.new.page = 1;
        
        const rawTerm = state.searchTerm.trim();
        const searchTerm = rawTerm.toLowerCase();
        if (searchTerm.length >= 3) {
            // Build word-boundary regex for ICD name (exact word match)
            const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameWordRegex = new RegExp(`\\b${escapeRegExp(rawTerm)}\\b`, 'i');

            // Filter
            const filtered = state.allSuggestionsCache.filter(row => {
                const nameHit = nameWordRegex.test(row.suggested_icd_name);
                const fieldHit = (
                    row.ayurveda_suggestions.toLowerCase().includes(searchTerm) ||
                    row.siddha_suggestions.toLowerCase().includes(searchTerm) ||
                    row.unani_suggestions.toLowerCase().includes(searchTerm)
                );
                return nameHit || fieldHit;
            });

            // Rank: bubble likely matches (ICD name and term hits) to the top
            const scoreRow = (row) => {
                let score = 0;
                const name = row.suggested_icd_name.toLowerCase();
                // Prefer exact word matches highest
                if (nameWordRegex.test(row.suggested_icd_name)) score += 1200;
                else if (name.startsWith(searchTerm)) score += 800;
                else if (name.includes(searchTerm)) score += 600;

                const ay = row.ayurveda_suggestions.toLowerCase();
                const si = row.siddha_suggestions.toLowerCase();
                const un = row.unani_suggestions.toLowerCase();
                if (ay.includes(searchTerm)) score += 50;
                if (si.includes(searchTerm)) score += 50;
                if (un.includes(searchTerm)) score += 50;
                return score;
            };
            filtered.sort((a, b) => {
                const sb = scoreRow(b) - scoreRow(a);
                return sb !== 0 ? sb : a.suggested_icd_name.localeCompare(b.suggested_icd_name);
            });
            state.filteredSuggestions = filtered;
        } else {
            state.filteredSuggestions = state.allSuggestionsCache;
        }
        
        state.pagination.new.total = state.filteredSuggestions.length;
        updateNewSuggestionsContent();
        if (searchLoader) searchLoader.classList.add('hidden');
        if (dom.contentArea) {
            dom.contentArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 300);
}

// --- Highlight Navigation Helpers ---
function updateHighlightMatches() {
    const countEl = document.getElementById('hl-count');
    const prevBtn = document.getElementById('hl-prev');
    const nextBtn = document.getElementById('hl-next');
    if (!state.highlightNav) state.highlightNav = { matches: [], index: 0 };

    if (!state.searchTerm || state.searchTerm.trim().length < 3) {
        state.highlightNav.matches = [];
        state.highlightNav.index = 0;
        if (countEl) countEl.textContent = '0/0';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    const marks = dom.contentArea ? Array.from(dom.contentArea.querySelectorAll('mark')) : [];
    state.highlightNav.matches = marks;
    state.highlightNav.index = marks.length > 0 ? 0 : 0;
    if (countEl) countEl.textContent = marks.length > 0 ? `1/${marks.length}` : '0/0';
    if (prevBtn) prevBtn.disabled = marks.length <= 1;
    if (nextBtn) nextBtn.disabled = marks.length <= 1;
    if (marks.length > 0) scrollHighlightIntoView(0);
}

function scrollHighlightIntoView(i) {
    const el = state.highlightNav.matches[i];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function nextHighlight() {
    if (!state.highlightNav || state.highlightNav.matches.length === 0) return;
    state.highlightNav.index = (state.highlightNav.index + 1) % state.highlightNav.matches.length;
    const countEl = document.getElementById('hl-count');
    if (countEl) countEl.textContent = `${state.highlightNav.index + 1}/${state.highlightNav.matches.length}`;
    scrollHighlightIntoView(state.highlightNav.index);
}

function prevHighlight() {
    if (!state.highlightNav || state.highlightNav.matches.length === 0) return;
    state.highlightNav.index = (state.highlightNav.index - 1 + state.highlightNav.matches.length) % state.highlightNav.matches.length;
    const countEl = document.getElementById('hl-count');
    if (countEl) countEl.textContent = `${state.highlightNav.index + 1}/${state.highlightNav.matches.length}`;
    scrollHighlightIntoView(state.highlightNav.index);
}

function updateCellUI(icdName, system) {
    const rowData = state.allSuggestionsCache.find(r => r.suggested_icd_name === icdName);
    if (!rowData) return;
    const safeIcdName = icdName.replace(/[^a-zA-Z0-9]/g, '-');
    const oldCell = document.getElementById(`cell-${safeIcdName}-${system}`);
    if (oldCell) {
        oldCell.outerHTML = createCurationCell(safeIcdName, icdName, system, rowData);
    }
}

function initializeDecisionObject(icdName, system) {
    if (!state.curationDecisions[icdName]) state.curationDecisions[icdName] = {};
    if (!state.curationDecisions[icdName][system] || typeof state.curationDecisions[icdName][system] !== 'object') {
        state.curationDecisions[icdName][system] = { primary: null, aliases: [], rejected_suggestions: [], review_suggestion: null };
    }
}

function handleSetPrimary(icdName, system, suggestionId) {
    initializeDecisionObject(icdName, system);
    const d = state.curationDecisions[icdName][system];
    d.primary = (d.primary === suggestionId) ? null : suggestionId;
    if (d.primary) {
        d.aliases = d.aliases.filter(id => id !== suggestionId);
        d.review_suggestion = null;
        d.rejected_suggestions = d.rejected_suggestions.filter(r => getSuggestionId(r.suggestion) !== suggestionId);
    }
    updateCellUI(icdName, system);
}

function handleAddAlias(icdName, system, suggestionId) {
    initializeDecisionObject(icdName, system);
    const d = state.curationDecisions[icdName][system];
    if (d.primary === suggestionId) return;

    d.rejected_suggestions = d.rejected_suggestions.filter(r => getSuggestionId(r.suggestion) !== suggestionId);

    const i = d.aliases.indexOf(suggestionId);
    if (i > -1) d.aliases.splice(i, 1); else d.aliases.push(suggestionId);
    
    updateUIAfterPopoverAction(icdName, system);
}

function handlePromoteToPrimary(icdName, system, suggestionId) {
    handleSetPrimary(icdName, system, suggestionId);
    hideSuggestionsPopover();
}

function handleSetReview(icdName, system, suggestionId) {
    initializeDecisionObject(icdName, system);
    const d = state.curationDecisions[icdName][system];
    d.review_suggestion = (d.review_suggestion === suggestionId) ? null : suggestionId;
    if (d.review_suggestion) {
        d.primary = null;
        d.aliases = [];
        d.rejected_suggestions = d.rejected_suggestions.filter(r => getSuggestionId(r.suggestion) !== suggestionId);
    }
    updateCellUI(icdName, system);
}

function handleReject(icdName, system, suggestionId, isPrimary) {
    initializeDecisionObject(icdName, system);
    const all = JSON.parse(state.allSuggestionsCache.find(r => r.suggested_icd_name === icdName)[`${system}_suggestions`]);
    const sugg = all.find(s => getSuggestionId(s) === suggestionId);
    state.rejectionContext = { icdName, system, suggestion: sugg, isPrimary };
    const isAlreadyRejected = state.curationDecisions[icdName][system].rejected_suggestions.some(r => getSuggestionId(r.suggestion) === suggestionId);
    dom.rejectionReasonView.classList.toggle('hidden', isAlreadyRejected);
    dom.rejectionUndoView.classList.toggle('hidden', !isAlreadyRejected);
    dom.rejectionModal.classList.remove('hidden');
}

function submitRejection(reason) {
    const { icdName, system, suggestion, isPrimary } = state.rejectionContext;
    if (!icdName || !system || !suggestion) return;
    initializeDecisionObject(icdName, system);
    const d = state.curationDecisions[icdName][system];
    const suggestionId = getSuggestionId(suggestion);
    if (!d.rejected_suggestions.some(r => getSuggestionId(r.suggestion) === suggestionId)) {
        d.rejected_suggestions.push({ suggestion, reason, isPrimary });
    }
    d.aliases = d.aliases.filter(id => id !== suggestionId);
    if (d.primary === suggestionId) d.primary = null;
    if (d.review_suggestion === suggestionId) d.review_suggestion = null;
    if (isPrimary) updateCellUI(icdName, system); else updateUIAfterPopoverAction(icdName, system);
    closeRejectionModal();
}

function submitUndoRejection() {
    const { icdName, system, suggestion, isPrimary } = state.rejectionContext;
    if (!icdName || !system || !suggestion) return;
    initializeDecisionObject(icdName, system);
    const d = state.curationDecisions[icdName][system];
    const suggestionId = getSuggestionId(suggestion);
    d.rejected_suggestions = d.rejected_suggestions.filter(r => getSuggestionId(r.suggestion) !== suggestionId);
    if (isPrimary) updateCellUI(icdName, system); else updateUIAfterPopoverAction(icdName, system);
    closeRejectionModal();
}

function closeRejectionModal() { dom.rejectionModal.classList.add('hidden'); }

async function handleSaveCuration() {
    const issues = [];
    const touchedIcds = Object.keys(state.curationDecisions);

    for (const icdName of touchedIcds) {
        const systemsForIcd = state.curationDecisions[icdName];
        const isRowEffectivelyEmpty = Object.values(systemsForIcd).every(decision =>
            !decision || (!decision.primary && !decision.review_suggestion && (!decision.aliases || decision.aliases.length === 0) && (!decision.rejected_suggestions || decision.rejected_suggestions.length === 0))
        );

        if (isRowEffectivelyEmpty) continue;

        const originalRow = state.allSuggestionsCache.find(r => r.suggested_icd_name === icdName);
        if (!originalRow) continue;

        // Determine if at least one system has any meaningful action (used to force validation on untouched systems with suggestions)
        const anyActionInRow = ['ayurveda','siddha','unani'].some(sys => {
            const d = systemsForIcd[sys];
            return d && (d.primary || d.review_suggestion || (d.aliases && d.aliases.length) || (d.rejected_suggestions && d.rejected_suggestions.length));
        });

        // Per-system validation: now also flags untouched systems if any action occurred in another system.
        for (const system of ['ayurveda', 'siddha', 'unani']) {
            const hasSuggestions = originalRow[`${system}_suggestions`] && originalRow[`${system}_suggestions`] !== '[]';
            if (!hasSuggestions) continue;

            const decision = systemsForIcd[system];
            const decisionIsEmpty = !decision || (!decision.primary && !decision.review_suggestion && (!decision.aliases || decision.aliases.length === 0) && (!decision.rejected_suggestions || decision.rejected_suggestions.length === 0));

            // If system untouched but row has other actions, user must resolve it
            if (decisionIsEmpty && anyActionInRow) {
                issues.push({ icdName, system, message: `A primary decision is required (or reject all suggestions).` });
                continue;
            }
            if (!decision || decisionIsEmpty) continue; // nothing else to validate

            if (decision.review_suggestion) {
                issues.push({ icdName, system, message: `Item is marked for review. Please approve or reject.` });
                continue;
            }
            const allSuggestions = JSON.parse(originalRow[`${system}_suggestions`]);
            const hasPrimaryDecision = !!decision.primary;
            const isPrimaryRejected = (decision.rejected_suggestions || []).some(r => r.isPrimary);
            const allRejected = Array.isArray(allSuggestions) && allSuggestions.length > 0 && ((decision.rejected_suggestions || []).length === allSuggestions.length);
            if (!hasPrimaryDecision && !isPrimaryRejected && !allRejected) {
                issues.push({ icdName, system, message: `A primary decision is required (or reject all suggestions).` });
            } else if (hasPrimaryDecision || isPrimaryRejected) {
                const primarySuggId = hasPrimaryDecision ? decision.primary : getSuggestionId(decision.rejected_suggestions.find(r => r.isPrimary).suggestion);
                const otherSuggs = allSuggestions.filter(s => getSuggestionId(s) !== primarySuggId);
                const untouchedCount = otherSuggs.filter(s => {
                    const sId = getSuggestionId(s);
                    return !(decision.aliases || []).includes(sId) && !(decision.rejected_suggestions || []).some(r => getSuggestionId(r.suggestion) === sId);
                }).length;
                if (untouchedCount > 0) {
                    issues.push({ icdName, system, message: `<span class=\"font-semibold text-red-600\">${untouchedCount} suggestion(s)</span> still require an action (link or reject).` });
                }
            }
        }
    }

    if (issues.length > 0) {
        showValidationModal(false, issues);
        return;
    }

    const promotionCandidates = [];
    const autoPromotionCases = [];
    for (const icdName in state.curationDecisions) {
        const systemsForIcd = state.curationDecisions[icdName];
        const isRowEffectivelyEmpty = Object.values(systemsForIcd).every(decision => !decision || (!decision.primary && !decision.review_suggestion && (!decision.aliases || decision.aliases.length === 0) && (!decision.rejected_suggestions || decision.rejected_suggestions.length === 0)));
        if (isRowEffectivelyEmpty) continue;

        for (const system in systemsForIcd) {
            const decision = systemsForIcd[system];
            if(!decision) continue;
            const originalRow = state.allSuggestionsCache.find(r => r.suggested_icd_name === icdName);
            if(!originalRow) continue;
            const allSuggestions = JSON.parse(originalRow[`${system}_suggestions`]||'[]');
            if(!allSuggestions.length) continue;
            const linkedAliases = (decision.aliases||[]).filter(a=>a!==decision.primary);
            const isPrimaryRejected = (decision.rejected_suggestions||[]).some(r=>r.isPrimary);
            const allRejected = (decision.rejected_suggestions||[]).length===allSuggestions.length;
            const hasPrimary = !!decision.primary;
            const review = !!decision.review_suggestion;

            // Condition for auto-promotion: this system currently has *no* primary mapping chosen, has at least one linked alias, not all rejected, and not in review.
            if(linkedAliases.length>0 && !hasPrimary && !review && !allRejected){
                // Determine best alias (highest confidence, tie -> earliest index)
                let best=null; let bestScore=-1;
                allSuggestions.forEach((s,idx)=>{
                    const sid=getSuggestionId(s);
                    if(linkedAliases.includes(sid)){
                        const conf=parseInt(s.confidence||0,10); const score=(isNaN(conf)?0:conf)*10000 + (10000-idx);
                        if(score>bestScore){ bestScore=score; best=s; }
                    }
                });
                if(best){
                    autoPromotionCases.push({icdName, system, bestAlias: best, aliasSystem: system, reason: isPrimaryRejected? 'primary_rejected_with_alias':'no_primary_alias_linked'});
                    continue; // already auto case; don't also push manual
                }
            }
            // Manual promotion candidate: if there are aliases but auto-promo condition wasn't met and no primary
            if(!hasPrimary && !review && linkedAliases.length>0 && !allRejected){
                const firstAlias = allSuggestions.find(s=> getSuggestionId(s)===linkedAliases[0]);
                if(firstAlias) promotionCandidates.push({ icdName, firstAlias, aliasSystem: system });
            }
        }
    }
    console.debug('[Curation][Debug] autoPromotionCases:', autoPromotionCases);
    console.debug('[Curation][Debug] promotionCandidates:', promotionCandidates);
    
    if (autoPromotionCases.length > 0) {
        showValidationModal('auto', autoPromotionCases);
        return;
    }

    if (promotionCandidates.length > 0) {
        showValidationModal('manual', promotionCandidates);
        return;
    }

    await performSave();
}

async function performSave(button = null) {
    const saveButton = button || document.querySelector('#fab-new-suggestions button');
    toggleButtonLoading(saveButton, true);
    
    const payload = [];
    const auditEvents = [];
    for (const [icdName, systems] of Object.entries(state.curationDecisions)) {
        if (Object.values(systems).every(dec => !dec || Object.values(dec).every(val => !val || (Array.isArray(val) && val.length === 0)))) continue;
        
        const originalRow = state.allSuggestionsCache.find(r => r.suggested_icd_name === icdName);
        if (!originalRow) continue;
        
        const statuses = {};
        for (const [system, decision] of Object.entries(systems)) {
            const allSuggestions = JSON.parse(originalRow[`${system}_suggestions`] || '[]');
            const systemStatus = {};

            // Auto-promotion enforcement just before serialization (idempotent if already promoted)
            if(decision){
                const hasPrimary = !!decision.primary;
                const isPrimaryRejected = (decision.rejected_suggestions||[]).some(r=>r.isPrimary);
                const linkedAliases = (decision.aliases||[]).filter(a=>a!==decision.primary);
                const allRejected = Array.isArray(allSuggestions) && allSuggestions.length>0 && ((decision.rejected_suggestions||[]).length===allSuggestions.length);
                if(!hasPrimary && linkedAliases.length>0 && !decision.review_suggestion && !allRejected){
                    let best=null; let bestScore=-1;
                    allSuggestions.forEach((s,idx)=>{
                        const sid=getSuggestionId(s);
                        if(linkedAliases.includes(sid)){
                            const conf=parseInt(s.confidence||0,10); const score=(isNaN(conf)?0:conf)*10000 + (10000-idx);
                            if(score>bestScore){ bestScore=score; best=s; }
                        }
                    });
                    if(best){
                        const bestId=getSuggestionId(best);
                        decision.primary=bestId;
                        decision.aliases=decision.aliases.filter(a=>a!==bestId);
                        auditEvents.push({type:'auto_promote', icd_name: icdName, system, term: best.term, code: best.code||'', reason: isPrimaryRejected? 'primary_rejected_with_alias':'no_primary_alias_linked'});
                    }
                }
            }
            
            if (decision.primary) {
                systemStatus.primary = allSuggestions.find(s => getSuggestionId(s) === decision.primary);
            }
            if (decision.aliases?.length > 0) {
                systemStatus.aliases = allSuggestions.filter(s => (decision.aliases || []).includes(getSuggestionId(s)));
            }
            if (decision.rejected_suggestions?.length > 0) {
                systemStatus.rejected_suggestions = decision.rejected_suggestions;
            }
            if (decision.review_suggestion) {
                systemStatus.review_suggestion = allSuggestions.find(s => getSuggestionId(s) === decision.review_suggestion);
            }
            
            if (Object.keys(systemStatus).length > 0) {
                statuses[system] = systemStatus;
            }
        }
        
        if (Object.keys(statuses).length > 0) {
            payload.push({ icd_name: icdName, statuses });
        }
    }

    let auditObject = null;
    if(auditEvents.length){
        auditObject = { _audit: true, events: auditEvents, ts: new Date().toISOString() };
    }

    if (payload.length === 0) {
        toggleButtonLoading(saveButton, false);
        return;
    }
    
    try {
        // Backend /submit-curation expects pure list of {icd_name, statuses}; send audit separately if present
        await fetchAPI('/admin/submit-curation', 'POST', payload);
        if(auditObject){
            // TODO: Implement backend endpoint /admin/curation-audit-log to persist these events
            try { await fetchAPI('/admin/curation-audit-log', 'POST', auditObject); } catch(e){ console.warn('Failed to send audit log', e); }
        }
        alert("Curation saved successfully!");
        // --- ADD THIS BLOCK ---
        // After a successful save, we MUST clear the cache so that
        // the suggestions list is fresh the next time we visit it.
        try {
            const db = await openCacheDb();
            await db.clear(SUGGESTIONS_STORE_NAME);
            console.log("Suggestions cache cleared after saving.");
        } catch (err) {
            console.error("Could not clear cache after save:", err);
        }
        // --- END OF ADDITION ---
        window.location.href = 'master_map.html';
    } catch (error) {
        try {
            if(error && error.response){
                const txt = await error.response.text();
                alert(`Failed to save curation: ${error.message}\nServer: ${txt}`);
            } else {
                alert(`Failed to save curation: ${error.message}`);
            }
        } catch{ alert(`Failed to save curation: ${error.message}`); }
        window.location.reload(); 
    } finally {
        toggleButtonLoading(saveButton, false);
    }
}


function showValidationModal(mode, data) {
    if (mode === 'manual') {
        const promotionListHtml = data.map(candidate =>
            `<li class="mb-1"><strong class=\"text-gray-800\">${candidate.icdName}</strong> • <span class=\"capitalize\">${candidate.aliasSystem}</span>: Alias <strong>'${candidate.firstAlias.term}'</strong> <span class=\"text-indigo-700 font-medium\">needs promotion to Primary</span></li>`
        ).join('');

        const message = `<p class=\"text-sm text-gray-700 mb-2\">These rows have no active Primary but you linked one or more aliases. Choose which alias becomes the new Primary (or go back and reject them all if none are valid).</p><ul class=\"list-disc pl-5 mt-2 mb-3\">${promotionListHtml}</ul><p class=\"text-[12px] text-gray-500\">If you don't pick manually, the system would auto-promote the highest-confidence alias. Manual selection lets you override that choice.</p>`;
        dom.promotionMessage.innerHTML = message;
        try {
            const heading = dom.validationPromoteView.querySelector('h3');
            if(heading){ heading.className = 'text-lg font-bold text-indigo-800 mb-4'; heading.innerHTML = '<i class="fa-solid fa-hand-pointer mr-2"></i>Action Needed – Pick a Primary Alias'; }
            const confirmLabel = dom.confirmPromoteButton.querySelector('.btn-text');
            if(confirmLabel) confirmLabel.textContent = 'Save After Selecting';
        } catch{}

        dom.confirmPromoteButton.onclick = () => {
            data.forEach(candidate => {
                const decision = state.curationDecisions[candidate.icdName][candidate.aliasSystem];
                const aliasId = getSuggestionId(candidate.firstAlias);
                decision.primary = aliasId;
                decision.aliases = decision.aliases.filter(id => id !== aliasId);
            });
            closeValidationModal();
            performSave(dom.confirmPromoteButton);
        };
        
        dom.validationErrorView.classList.add('hidden');
        dom.validationPromoteView.classList.remove('hidden');
    } else if (mode === 'auto') {
        // Auto-promotion preview list with explicit wording & reason
        const autoList = data.map(c=>{
            const reasonLabel = c.reason === 'primary_rejected_with_alias' ? 'primary was rejected' : 'no primary chosen';
            return `<li class="mb-1"><strong class=\"text-gray-800\">${c.icdName}</strong> • <span class=\"capitalize\">${c.system}</span>: Alias <strong>'${c.bestAlias.term}'</strong> (${c.bestAlias.code||'n/a'}) <span class=\"text-amber-700 font-medium\">will be promoted as Primary</span> <span class=\"text-[11px] text-gray-500\">(${reasonLabel})</span></li>`;
        }).join('');
        const message = `<p class="text-sm text-gray-700 mb-2">To prevent data loss, each row below has no active primary but has at least one linked alias. The highlighted alias will be promoted as the new Primary mapping when you continue.</p><ul class="list-disc pl-5 mt-2 mb-3">${autoList}</ul><p class="text-[12px] text-gray-500">Cancel to review manually or Confirm to apply these promotions and save.</p>`;
        // Adjust heading to warning style instead of question style
        try {
            const heading = dom.validationPromoteView.querySelector('h3');
            if(heading){ heading.className = 'text-lg font-bold text-amber-800 mb-4'; heading.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-2"></i>Action Required – Auto Promotion Pending'; }
            const confirmLabel = dom.confirmPromoteButton.querySelector('.btn-text');
            if(confirmLabel) confirmLabel.textContent = 'Confirm & Save';
        } catch{}
        dom.promotionMessage.innerHTML = message;
        dom.confirmPromoteButton.onclick = () => {
            data.forEach(c => {
                const decision = state.curationDecisions[c.icdName][c.system];
                if(decision){
                    const aliasId = getSuggestionId(c.bestAlias);
                    decision.primary = aliasId;
                    decision.aliases = (decision.aliases||[]).filter(a=>a!==aliasId);
                }
            });
            closeValidationModal();
            performSave(dom.confirmPromoteButton);
        };
        dom.validationErrorView.classList.add('hidden');
        dom.validationPromoteView.classList.remove('hidden');
    } else {
        dom.validationIssues.innerHTML = data.map(issue => `
            <div class="p-1 bg-white border rounded-md">
                <p class="font-bold text-gray-800">${issue.icdName}</p>
                <p class="text-xs text-gray-500 capitalize">${issue.system}: ${issue.message}</p>
            </div>`).join('');
        dom.validationPromoteView.classList.add('hidden');
        dom.validationErrorView.classList.remove('hidden');
    }
    dom.validationModal.classList.remove('hidden');
}

function closeValidationModal() {
    dom.validationModal.classList.add('hidden');
}

function showSuggestionsPopover(buttonElement, icdName, system) {
    state.popoverContext = { button: buttonElement, icdName, system };
    if (!dom.suggestionsPopover.classList.contains('hidden') && dom.suggestionsPopover.dataset.trigger === buttonElement.id) {
        hideSuggestionsPopover();
        return;
    }
    renderSuggestionsPopover();
    positionPopover();
    dom.suggestionsPopover.classList.remove('hidden');
}

function renderSuggestionsPopover() {
    const { button, icdName, system } = state.popoverContext;
    if (!button || !icdName || !system) return;

    const rowData = state.allSuggestionsCache.find(r => r.suggested_icd_name === icdName);
    if (!rowData) return;

    const suggestions = JSON.parse(rowData[`${system}_suggestions`]);
    const decisionObj = state.curationDecisions[icdName]?.[system] || {};

    let primarySugg = null;
    const approvedPrimaryId = decisionObj.primary;
    const rejectedPrimaryInfo = (decisionObj.rejected_suggestions || []).find(r => r.isPrimary);

    if (approvedPrimaryId) primarySugg = suggestions.find(s => getSuggestionId(s) === approvedPrimaryId);
    else if (decisionObj.review_suggestion) primarySugg = suggestions.find(s => getSuggestionId(s) === decisionObj.review_suggestion);
    else if (rejectedPrimaryInfo) primarySugg = rejectedPrimaryInfo.suggestion;
    else primarySugg = suggestions.find(s => !(decisionObj.rejected_suggestions || []).some(r => getSuggestionId(r.suggestion) === getSuggestionId(s)));

    if (!primarySugg) { hideSuggestionsPopover(); return; }
    
    const otherSuggs = suggestions.filter(s => getSuggestionId(s) !== getSuggestionId(primarySugg));
    const popoverContentHtml = otherSuggs.map(sugg => renderSuggestion(sugg, icdName, system, 'alias')).join('');

    if (!popoverContentHtml) { hideSuggestionsPopover(); return; }

    const closeButtonHtml = `<button onclick="hideSuggestionsPopover()" class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition-colors"><i class="fa-solid fa-times"></i></button>`;
    dom.suggestionsPopover.innerHTML = `<div class="relative p-2 space-y-2">${closeButtonHtml}${popoverContentHtml}</div>`;
    dom.suggestionsPopover.dataset.trigger = button.id;
}

function updateUIAfterPopoverAction(icdName, system) {
    const popoverBtnId = state.popoverContext.button?.id;
    updateCellUI(icdName, system);
    if (!popoverBtnId) return;

    const newButton = document.getElementById(popoverBtnId);
    if (newButton) {
        state.popoverContext.button = newButton;
        renderSuggestionsPopover();
        positionPopover();
        dom.suggestionsPopover.classList.remove('hidden');
    } else {
        hideSuggestionsPopover();
    }
}

// --- PAGINATION ---

function renderPagination() {
    const { page, limit, total } = state.pagination.new;
    let paginationHtml = '';

    if (total > limit) {
        const totalPages = Math.ceil(total / limit);

        const startIndex = (page - 1) * limit + 1;
        const endIndex = Math.min(page * limit, total);
        const info = `<p class="text-sm text-gray-700">Showing <span class="font-medium">${startIndex}</span> to <span class="font-medium">${endIndex}</span> of <span class="font-medium">${total}</span> results</p>`;

        const pageButton = (p, label = null, disabled = false, active = false) => {
            const lbl = label ?? p;
            const base = 'relative inline-flex items-center px-3 py-2 border text-sm font-medium';
            const stateCls = active ? ' bg-indigo-600 text-white' : ' bg-white hover:bg-gray-50';
            const disabledCls = disabled ? ' opacity-50 cursor-not-allowed' : '';
            const handler = disabled ? '' : `onclick="changePage(${p})"`;
            return `<button ${handler} ${disabled ? 'disabled' : ''} class="${base}${stateCls}${disabledCls}">${lbl}</button>`;
        };

        const firstDisabled = page === 1;
        const lastDisabled = page === totalPages;
        const prevPage = Math.max(1, page - 1);
        const nextPage = Math.min(totalPages, page + 1);

        // Build compact number window with ellipses
        const windowSize = 2; // how many numbers to show on each side
        const winStart = Math.max(1, page - windowSize);
        const winEnd = Math.min(totalPages, page + windowSize);

        let numbers = '';

        // Always show first page
        numbers += pageButton(1, '1', false, page === 1);

        // Ellipses if window start is beyond 2
        if (winStart > 2) {
            numbers += `<span class="px-2 select-none">…</span>`;
        }

        // Middle window (excluding first/last to avoid duplicates)
        for (let i = winStart; i <= winEnd; i++) {
            if (i !== 1 && i !== totalPages) {
                numbers += pageButton(i, String(i), false, i === page);
            }
        }

        // Ellipses if window end is before last-1
        if (winEnd < totalPages - 1) {
            numbers += `<span class="px-2 select-none">…</span>`;
        }

        // Always show last page (if more than one page)
        if (totalPages > 1) {
            numbers += pageButton(totalPages, String(totalPages), false, page === totalPages);
        }

        const nav = `
            <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                ${pageButton(1, 'First', firstDisabled)}
                ${pageButton(prevPage, 'Prev', firstDisabled)}
                ${numbers}
                ${pageButton(nextPage, 'Next', lastDisabled)}
                ${pageButton(totalPages, 'Last', lastDisabled)}
            </nav>`;

        paginationHtml = `
            <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between w-full">
                <div>${info}</div>
                <div>${nav}</div>
            </div>`;
    }

    if (dom.suggestionsPaginationTop) {
        dom.suggestionsPaginationTop.innerHTML = paginationHtml;
    }
    if (dom.suggestionsPagination) {
        dom.suggestionsPagination.innerHTML = paginationHtml;
    }
}

function changePage(newPage) {
    state.pagination.new.page = newPage;
    updateNewSuggestionsContent();
    if (dom.contentArea) {
        dom.contentArea.scrollIntoView({ behavior: 'smooth' });
    }
}

// Hook: listen for promote actions via global fetch wrapper by monkey-patching fetchAPI for specific endpoint
// Safer: provide explicit helper used by ingestion pages (if any) but here we intercept promote calls if invoked in this page context.
const _origFetchAPI = window.fetchAPI;
window.fetchAPI = async function(endpoint, method='GET', body=null){
    const res = await _origFetchAPI(endpoint, method, body);
    try {
        if(endpoint.match(/ingest\/rows\/\d+\/promote$/) && res && typeof res==='object'){
            if(res.placement){
                showToast(`Suggestion promoted as ${res.placement==='primary'?'Primary':'Alias'}`, res.placement==='primary'?'success':'info');
            }
            // Granular cache invalidation: remove only the ICD group promoted
            if(res.icd_name){
                await invalidateSuggestion?.(res.icd_name);
            } else if(res.suggested_icd_name){
                await invalidateSuggestion?.(res.suggested_icd_name);
            } else if(res.row_id){
                // Fallback: if backend didn't return name, clear full cache (legacy behavior)
                await clearSuggestionsCache?.();
            }
        }
    }catch(e){ console.warn('Promotion toast hook failed', e); }
    return res;
};