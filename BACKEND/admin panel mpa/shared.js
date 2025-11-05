// This file contains shared state, API functions, and utilities used across all pages.

// Prefer runtime-configured API base URL if provided by config.js; fallback to localhost for dev.
const API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : 'http://127.0.0.1:8000/api';

// Expose helpers for other pages (avoid duplicating constants)
window.apiBase = function () {
    try {
        // Strip trailing '/api' to get host base
        return API_BASE_URL.replace(/\/?api$/, '');
    } catch { return 'http://127.0.0.1:8000'; }
}
window.getToken = function () {
    return state.token || localStorage.getItem('accessToken');
}

// Global state object. Each page will populate the parts it needs.
const state = {
    token: null,
    allSuggestionsCache: [],
    filteredSuggestions: [],
    data: {
        master: [],
        rejected: { needs_correction: [], no_mapping: [] },
        icdMasterList: []
    },
    curationDecisions: {},
    pagination: { new: { page: 1, limit: 20, total: 0 } },
    stats: { review: 0, master_map: 0, rejected: 0, completeness: {} },
    rejectionContext: { icdName: null, system: null, suggestion: null, isPrimary: null },
    popoverContext: { button: null, icdName: null, system: null },
    editorContext: { icdName: null, system: null },
    searchTerm: '',
    searchTimeout: null
};

// ================================
// Persistent Deep Reset (Overall Reset) – localStorage keys
// ================================
const DEEP_RESET_STATUS_KEY = 'deepResetStatusLatest';
const DEEP_RESET_MINIMIZED_KEY = 'deepResetStatusMinimized';
const DEEP_RESET_SUCCESS_TOAST_KEY = 'deepResetJustCompleted';


// Global DOM elements cache
const dom = {};

// This runs on every page load for authenticated pages.
document.addEventListener('DOMContentLoaded', () => {
    state.token = localStorage.getItem('accessToken');
    if (!state.token) {
        window.location.href = 'index.html'; // Redirect to login if not authenticated
        return;
    }
    initializeApp();
});

// Initializes common elements and fetches data needed on all pages.
async function initializeApp() {
    // Show the main app screen
    document.getElementById('app-screen').classList.remove('hidden');

    // Populate the DOM cache
    Object.assign(dom, {
        appScreen: document.getElementById('app-screen'),
        contentArea: document.getElementById('content-area'),
        mainLoader: document.getElementById('main-loader'),
        logoutButton: document.getElementById('logout-button'),
        // Stats
        statReview: document.getElementById('stat-review'),
    statMasterMap: document.getElementById('stat-master-map'),
    statMasterMapVerified: document.getElementById('stat-master-map-verified'),
        statRejected: document.getElementById('stat-rejected'),
        statThreeSystems: document.getElementById('stat-three-systems'),
        statTwoSystems: document.getElementById('stat-two-systems'),
        statOneSystem: document.getElementById('stat-one-system'),
        // Modals & Popovers (might not exist on all pages, so check for null)
        suggestionsPopover: document.getElementById('suggestions-popover'),
    });

    // Attach common event listeners
    if (dom.logoutButton) dom.logoutButton.addEventListener('click', handleLogout);
    const deepResetBtn = document.getElementById('deep-reset-button');
    if (deepResetBtn) deepResetBtn.addEventListener('click', () => openDeepResetModal(deepResetBtn));
    
    // Add scroll listener for popover positioning if it exists
    const mainContentArea = document.querySelector('main');
    if (mainContentArea) {
        mainContentArea.addEventListener('scroll', updatePopoverPositionOnScroll);
    }
    
    await fetchSharedData();

    // Resume any in‑progress overall reset (deep reset) after stats load so token is confirmed
    await resumeDeepResetMonitoring();

    // Call the specific initializer for the current page (must be defined in the page's JS file)
    if (typeof initializePage === 'function') {
        try { initializePage(); } catch (e) { console.error('initializePage failed:', e); }
    } else {
        if (dom.mainLoader) dom.mainLoader.classList.add('hidden');
        if (dom.contentArea) dom.contentArea.innerHTML = `<p class="p-8 text-red-500">Page-specific initializer function not found.</p>`;
    }
}

// Fetches data that is displayed on all pages (like stats).
async function fetchSharedData() {
    try {
        const [statsRes, completenessStatsRes] = await Promise.all([
            fetchAPI('/admin/stats'),
            fetchAPI('/admin/completeness-stats'),
        ]);
        state.stats = { ...statsRes, completeness: completenessStatsRes };
        updateStats();
    } catch (error) {
        console.error("Error fetching shared data:", error);
    }
}

// Lightweight toast system
function showToast(message, type='info', timeout=4000){
    let container = document.getElementById('toast-container');
    if(!container){
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 right-4 z-50 flex flex-col space-y-2';
        document.body.appendChild(container);
    }
    const colors = {
        info: 'bg-gray-800 text-white',
        success: 'bg-green-600 text-white',
        warn: 'bg-amber-500 text-white',
        error: 'bg-red-600 text-white'
    };
    const div = document.createElement('div');
    div.className = `shadow-lg px-4 py-2 rounded text-sm font-medium flex items-center ${colors[type]||colors.info} animate-fade-in`;
    div.textContent = message;
    container.appendChild(div);
    setTimeout(()=>{div.classList.add('opacity-0'); setTimeout(()=>div.remove(),300);}, timeout);
}
window.showToast = showToast;

// Cache bust: remove one suggestion entry from IndexedDB + in-memory caches
async function invalidateSuggestion(icdName){
    try{
        const DB_NAME='NamasteICD_DB';
        const SUGGESTIONS_STORE_NAME='suggestions_cache';
        const db = await idb.openDB(DB_NAME,2);
        await db.delete(SUGGESTIONS_STORE_NAME, icdName);
        // Remove from in-memory caches
        state.allSuggestionsCache = state.allSuggestionsCache.filter(r=>r.suggested_icd_name!==icdName);
        state.filteredSuggestions = state.filteredSuggestions.filter(r=>r.suggested_icd_name!==icdName);
    }catch(e){ console.warn('invalidateSuggestion failed', e); }
}
window.invalidateSuggestion = invalidateSuggestion;

// --- COMMON FUNCTIONS ---

function handleLogout() {
    localStorage.removeItem('accessToken');
    window.location.href = 'index.html';
}

/* Legacy reset handler kept for reference (old double-click + embedded deep reset code). */

/*
async function handleResetCuration_OLD(button) {
    if (!confirm("This will delete all curated data and regenerate suggestions. This may take a moment. Continue?")) return;
    
     // --- ADD THIS LINE ---
    // Invalidate the cache because we are about to fetch fresh data.
    localStorage.removeItem('allSuggestionsCache');
    // --- END OF ADDITION ---
    
    toggleButtonLoading(button, true, 'Resetting...');
    dom.mainLoader.classList.remove('hidden');
    dom.contentArea.innerHTML = '';
    try {
        const result = await fetchAPI('/admin/reset-curation', 'POST');
        alert(result.message);
        // After reset, redirect to the suggestions page as it's the primary workflow start.
        window.location.href = 'new_suggestions.html';
    } catch (error) {
        alert(`Failed to reset: ${error.message}`);
        dom.mainLoader.classList.add('hidden');
    } finally {
        toggleButtonLoading(button, false, 'Reset Curation');
    }
*/

// Reset Curation function removed - only Overall Reset is available now

// Shared helper: clear the IndexedDB suggestions cache used by New Suggestions page
async function clearSuggestionsCache() {
    try {
        console.log("🧹 Clearing IndexedDB suggestions cache...");
        const DB_NAME = 'NamasteICD_DB';
        const SUGGESTIONS_STORE_NAME = 'suggestions_cache';
        const DB_VERSION = 3; // Match the version in new_suggestions.js
        
        try {
            const db = await idb.openDB(DB_NAME, DB_VERSION);
            await db.clear(SUGGESTIONS_STORE_NAME);
            console.log("✅ Suggestions cache cleared.");
        } catch (err) {
            console.warn("⚠️ Failed to clear cache, deleting database:", err);
            // If clearing fails, delete the entire database
            await idb.deleteDB(DB_NAME);
            console.log("✅ Database deleted.");
        }
        
        try { localStorage.setItem('suggestionsInvalidate', String(Date.now())); } catch {}
    } catch (err) {
        console.error("❌ Failed to clear IndexedDB cache:", err);
        // Try to delete DB as last resort
        try {
            await idb.deleteDB('NamasteICD_DB');
        } catch {}
    }
}
// Expose a helper to invalidate after promotions without full clear (just bump timestamp)
window.bumpSuggestionsInvalidate = function(){ try { localStorage.setItem('suggestionsInvalidate', String(Date.now())); } catch {} };

function updateStats() {
    if (dom.statReview && state.stats) dom.statReview.textContent = state.stats.review ?? 0;
    if (dom.statMasterMap && state.stats) dom.statMasterMap.textContent = state.stats.master_map ?? 0;
    if (dom.statMasterMapVerified && state.stats) dom.statMasterMapVerified.textContent = state.stats.master_map_verified ?? 0;
    if (dom.statRejected && state.stats) dom.statRejected.textContent = state.stats.rejected ?? 0;
    if (dom.statThreeSystems && state.stats.completeness) dom.statThreeSystems.textContent = state.stats.completeness.three_systems ?? 0;
    if (dom.statTwoSystems && state.stats.completeness) dom.statTwoSystems.textContent = state.stats.completeness.two_systems ?? 0;
    if (dom.statOneSystem && state.stats.completeness) dom.statOneSystem.textContent = state.stats.completeness.one_system ?? 0;
}

// ================================
// Deep Reset (Overall Reset) New Implementation
// ================================
function openDeepResetModal(triggerBtn) {
    let modal = document.getElementById('deep-reset-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'deep-reset-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = `
          <div class="bg-white w-full max-w-md rounded-lg shadow-xl p-6 relative">
             <h3 class="text-lg font-bold text-red-700 mb-3">Confirm Deep Reset</h3>
             <p class="text-sm text-gray-700 mb-4">This will <span class="font-semibold">WIPE ALL</span> ICD codes, traditional terms, mappings, audits and regenerate everything from the discovery pipeline. This action cannot be undone.</p>
             <div class="bg-red-50 border border-red-200 p-3 rounded text-xs text-red-800 mb-4">Expect several steps: truncation, cleanup, discovery, validation. You can monitor progress live at the bottom of the screen once started.</div>
             <label class="block text-xs font-medium text-gray-600 mb-1">Type <span class="font-mono bg-gray-100 px-1 py-0.5 rounded">RESET ALL</span> to enable the button:</label>
             <input id="deep-reset-confirm-input" type="text" class="w-full border rounded px-3 py-2 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="RESET ALL" />
             <div class="flex justify-end space-x-3">
                <button id="deep-reset-cancel" class="text-sm px-4 py-2 rounded-md border hover:bg-gray-100">Cancel</button>
                <button id="deep-reset-confirm" disabled class="text-sm px-4 py-2 rounded-md bg-red-600 text-white opacity-60 cursor-not-allowed flex items-center">
                    <span class="btn-text">Start Deep Reset</span>
                    <div class="loader hidden ml-2"></div>
                </button>
             </div>
          </div>`;
        document.body.appendChild(modal);
        // Wiring
        modal.querySelector('#deep-reset-cancel').addEventListener('click', () => modal.remove());
        const input = modal.querySelector('#deep-reset-confirm-input');
        const confirmBtn = modal.querySelector('#deep-reset-confirm');
        input.addEventListener('input', () => {
            if (input.value.trim().toUpperCase() === 'RESET ALL') {
                confirmBtn.disabled = false;
                confirmBtn.classList.remove('opacity-60','cursor-not-allowed');
            } else {
                confirmBtn.disabled = true;
                confirmBtn.classList.add('opacity-60','cursor-not-allowed');
            }
        });
        confirmBtn.addEventListener('click', async () => {
            if (confirmBtn.disabled) return;
            await handleDeepReset(confirmBtn, modal, triggerBtn);
        });
    }
}

async function handleDeepReset(workingBtn, modal, triggerBtn) {
    toggleButtonLoading(workingBtn, true, 'Starting...');
    try {
        // Proactively clear suggestions cache & mark reset start so New Suggestions page reloads fresh
        try { await clearSuggestionsCache(); } catch {}
        try { localStorage.setItem('curationResetAt', String(Date.now())); } catch {}
        const resp = await fetchAPI('/admin/deep-reset', 'POST');
        if (resp.status !== 'accepted') throw new Error('Unexpected response starting deep reset');
        alert('Deep reset started. Progress will appear at the bottom. You can keep browsing.');
        if (modal) modal.remove();
        if (triggerBtn) triggerBtn.disabled = true;
        startDeepResetPolling(triggerBtn || workingBtn);
    } catch (e) {
        alert('Failed to start deep reset: ' + e.message);
        toggleButtonLoading(workingBtn, false, 'Start Deep Reset');
    }
}

function startDeepResetPolling(button) {
    const statusBar = ensureDeepResetStatusBar();
    const pollInterval = 2500;
    (async function poll(){
        try {
            const data = await fetchAPI('/admin/deep-reset-status');
            await updateDeepResetStatus(statusBar, data);
            if (data.state === 'completed') {
                if (button) { toggleButtonLoading(button, false, 'Overall Reset'); button.disabled = false; }
                // Set completion toast flag and show toast
                try {
                    if (!localStorage.getItem(DEEP_RESET_SUCCESS_TOAST_KEY)) {
                        showDeepResetSuccessToast();
                        localStorage.setItem(DEEP_RESET_SUCCESS_TOAST_KEY, '1');
                    }
                } catch {}
                // Immediately clear status-related keys so it won't reappear on navigation
                try {
                    localStorage.removeItem(DEEP_RESET_STATUS_KEY);
                    localStorage.removeItem(DEEP_RESET_MINIMIZED_KEY);
                } catch {}
                fadeOutDeepResetUI();
                setTimeout(()=> window.location.href='new_suggestions.html', 2600);
                return;
            } else if (data.state === 'error') {
                if (button) { toggleButtonLoading(button, false, 'Overall Reset'); button.disabled = false; }
                alert('Deep reset error: ' + (data.error || 'Unknown'));
                return;
            }
        } catch (err) {
            console.error('Deep reset poll failed', err);
        }
        setTimeout(poll, pollInterval);
    })();
}

function ensureDeepResetStatusBar() {
    let bar = document.getElementById('deep-reset-status-bar');
    if (!bar) {
                ensureDeepResetStyles();
                bar = document.createElement('div');
                bar.id = 'deep-reset-status-bar';
                bar.className = 'fixed bottom-2 left-1/2 -translate-x-1/2 bg-white shadow-lg border rounded px-4 pt-3 pb-2 z-50 w-[90%] max-w-3xl transition-all';
                bar.innerHTML = `
                        <div class="flex items-center justify-between mb-1">
                            <div class="flex items-center gap-2">
                                <h4 class="font-semibold text-gray-800 text-sm">Overall Reset Progress</h4>
                                <span id="deep-reset-percent" class="text-[11px] text-gray-600 font-mono">0%</span>
                            </div>
                            <div class="flex items-center gap-2">
                                 <button id="deep-reset-toggle" class="text-xs text-gray-500 hover:text-gray-700">Minimize</button>
                                 <button id="deep-reset-hide" class="text-xs text-gray-400 hover:text-gray-600">Hide</button>
                            </div>
                        </div>
                        <div class="w-full bg-gray-200 h-2 rounded overflow-hidden mb-2 relative">
                            <div class="h-2 deep-reset-bar transition-all" style="width:0%" id="deep-reset-progress"></div>
                        </div>
                        <div id="deep-reset-phase" class="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1"></div>
                        <div id="deep-reset-steps" class="text-[11px] leading-snug font-mono max-h-40 overflow-y-auto bg-gray-50 border rounded p-2"></div>`;
                document.body.appendChild(bar);

                // Wire hide
                bar.querySelector('#deep-reset-hide').addEventListener('click', () => {
                        bar.remove();
                        const badge = document.getElementById('deep-reset-badge');
                        if (badge) badge.remove();
                });
                // Wire minimize toggle
                const toggleBtn = bar.querySelector('#deep-reset-toggle');
                toggleBtn.addEventListener('click', () => {
                        const minimized = !bar.style.display || bar.style.display !== 'none' ? true : false; // toggle notion
                        setDeepResetMinimized(minimized);
                });
                // Initial minimize state from storage
                try { if (localStorage.getItem(DEEP_RESET_MINIMIZED_KEY) === '1') setDeepResetMinimized(true); } catch {}
    }
    return bar;
}

async function updateDeepResetStatus(bar, status) {
    const progEl = document.getElementById('deep-reset-progress');
    const pct = Math.min(100, (status.progress || 0) * 100);
    if (progEl) progEl.style.width = `${pct}%`;
    const pctEl = document.getElementById('deep-reset-percent');
    if (pctEl) pctEl.textContent = `${pct.toFixed(0)}%`;
    updateDeepResetBadge(pct);
    const stepsEl = document.getElementById('deep-reset-steps');
    if (stepsEl && Array.isArray(status.steps)) {
        // Filter and keep important steps (main steps) and latest discovery progress
        const importantSteps = status.steps.filter(s => {
            const msg = s.msg || '';
            // Keep all main step messages (1/6, 2/6, etc) and latest discovery progress
            return msg.includes('[1/6]') || msg.includes('[2/6]') || msg.includes('[3/6]') || 
                   msg.includes('[4/6]') || msg.includes('[5/6]') || msg.includes('[6/6]') ||
                   msg.includes('ERROR') || msg.includes('Sanity') || msg.includes('completed');
        });
        
        // Get latest discovery progress if exists
        const discoverySteps = status.steps.filter(s => (s.msg || '').includes('Discovery Progress:'));
        const latestDiscovery = discoverySteps.length > 0 ? discoverySteps[discoverySteps.length - 1] : null;
        
        // Combine: show important steps + latest discovery progress
        const displaySteps = [...importantSteps];
        if (latestDiscovery) {
            // Insert latest discovery after step 4/6
            const step4Index = displaySteps.findIndex(s => (s.msg || '').includes('[4/6]'));
            if (step4Index >= 0) {
                displaySteps.splice(step4Index + 1, 0, latestDiscovery);
            }
        }
        
        stepsEl.innerHTML = displaySteps.map(s=>`<div>${escapeHtml((s.ts||'').split('T')[1]||'') } - ${escapeHtml(s.msg)}</div>`).join('');
        stepsEl.scrollTop = stepsEl.scrollHeight;
    }
    const phase = inferDeepResetPhase(status);
    const phaseEl = document.getElementById('deep-reset-phase');
    if (phaseEl) phaseEl.textContent = phase.label;
    applyPhaseColor(phase.key);
    if (status.state === 'completed') {
        stepsEl.innerHTML += '<div class="text-green-700 font-semibold mt-1">DONE ✅</div>';
        // Final cache bust to ensure any lingering cached suggestions are flushed
        try { await clearSuggestionsCache(); } catch {}
    } else if (status.state === 'error') {
        stepsEl.innerHTML += `<div class=\"text-red-600 font-semibold mt-1\">ERROR: ${escapeHtml(status.error || 'Unknown')} <button id=\"deep-reset-retry\" class=\"ml-2 px-2 py-0.5 bg-red-600 text-white rounded text-[10px]\">Retry</button></div>`;
        const retryBtn = document.getElementById('deep-reset-retry');
        if (retryBtn) retryBtn.onclick = restartDeepReset;
    }

    // Persist latest (unless finished -> we still store final for one refresh cycle)
    try {
        localStorage.setItem(DEEP_RESET_STATUS_KEY, JSON.stringify(status));
        if (status.state === 'completed' || status.state === 'error') {
            // Remove after short delay so user can still see on one reload if they refresh immediately
            setTimeout(()=> localStorage.removeItem(DEEP_RESET_STATUS_KEY), 10_000);
        }
    } catch {}
}

function escapeHtml(str){
    return String(str||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));
}

// Expose (if other modules need)
window.openDeepResetModal = openDeepResetModal;


function getSuggestionId(suggestion) {
    return `${suggestion.term}-${suggestion.code}`.replace(/[^a-zA-Z0-9]/g, '-');
}

// --- API WRAPPER ---
async function fetchAPI(endpoint, method = 'GET', body = null) {
    // Always get the freshest token from localStorage as fallback
    const token = state.token || localStorage.getItem('accessToken');
    if (!token) {
        console.error('❌ No auth token available for API request');
        handleLogout();
        throw new Error('Authentication required');
    }
    
    const options = {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' },
    };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    if (response.status === 401) {
        handleLogout();
        throw new Error('401 Unauthorized. Logging out.');
    }
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: `An unknown error occurred (${response.status})` }));
        throw new Error(errorData.detail);
    }
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        return response.json();
    }
    return {};
}

// --- UTILITIES ---
function toggleButtonLoading(button, isLoading, loadingText = '') {
    if (!button) return;
    const btnText = button.querySelector('.btn-text');
    if (!btnText) {
        button.disabled = isLoading;
        return;
    }
    const originalText = btnText.dataset.originalText || btnText.textContent;
    if (!btnText.dataset.originalText) btnText.dataset.originalText = originalText;
    const loader = button.querySelector('.loader');
    button.disabled = isLoading;
    if (isLoading) {
        btnText.textContent = loadingText || originalText;
        if (loader) loader.classList.remove('hidden');
    } else {
        btnText.textContent = originalText;
        if (loader) loader.classList.add('hidden');
    }
}

// Text highlighting utility (was removed inadvertently). Wraps search term occurrences in <mark>.
// Safeguards: only highlight if searchTerm length >= 3.
function highlightMatches(text, searchTerm) {
    if (!text || !searchTerm || searchTerm.trim().length < 3) return text || '';
    try {
        const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return String(text).replace(regex, '<mark class="bg-yellow-200 px-0.5 rounded-sm">$1</mark>');
    } catch (e) {
        return text;
    }
}
window.highlightMatches = highlightMatches;

function positionPopover() {
    const { button } = state.popoverContext;
    if (!button || !document.body.contains(button)) {
        hideSuggestionsPopover();
        return;
    }
    const rect = button.getBoundingClientRect();
    dom.suggestionsPopover.style.visibility = 'hidden';
    dom.suggestionsPopover.classList.remove('hidden');
    const popoverHeight = dom.suggestionsPopover.offsetHeight;
    const popoverWidth = dom.suggestionsPopover.offsetWidth;
    dom.suggestionsPopover.classList.add('hidden');
    dom.suggestionsPopover.style.visibility = 'visible';
    let top = window.scrollY + rect.top - popoverHeight - 8;
    let left = window.scrollX + rect.left + (rect.width / 2) - (popoverWidth / 2);
    if (top < window.scrollY) { top = window.scrollY + rect.bottom + 8; }
    if (left < 0) { left = 5; }
    if ((left + popoverWidth) > window.innerWidth) { left = window.innerWidth - popoverWidth - 5; }
    dom.suggestionsPopover.style.top = `${top}px`;
    dom.suggestionsPopover.style.left = `${left}px`;
}

// Restored helper: keep popover aligned while scrolling (was removed in recent refactor)
function updatePopoverPositionOnScroll() {
    if (dom.suggestionsPopover && !dom.suggestionsPopover.classList.contains('hidden')) {
        positionPopover();
    }
}

function hideSuggestionsPopover() {
    if (dom.suggestionsPopover) {
        dom.suggestionsPopover.classList.add('hidden');
        dom.suggestionsPopover.removeAttribute('data-trigger');
        state.popoverContext = { button: null, icdName: null, system: null };
    }
}

// Expose a couple of helpers for page modules
window.fetchSharedData = fetchSharedData;
window.state = state; // useful for debugging

// ================================
// Resume deep reset monitoring on page load (for persistence across navigation / refresh)
// ================================
async function resumeDeepResetMonitoring() {
    // If we have a cached status, draw it immediately (optimistic) before first poll
    try {
        const cached = localStorage.getItem(DEEP_RESET_STATUS_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.state && parsed.state !== 'completed' && parsed.state !== 'error') {
                const bar = ensureDeepResetStatusBar();
                updateDeepResetStatus(bar, parsed);
            }
        }
    } catch {}
    // Probe backend for actual current status; if running, start polling
    try {
        const data = await fetchAPI('/admin/deep-reset-status');
        if (['queued','running'].includes(data.state)) {
            const bar = ensureDeepResetStatusBar();
            updateDeepResetStatus(bar, data);
            startDeepResetPolling(null); // pass null so polling just updates UI
        } else if (data.state === 'completed') {
            // Only show success toast once; if flag already set, do nothing
            if (!localStorage.getItem(DEEP_RESET_SUCCESS_TOAST_KEY)) {
                showDeepResetSuccessToast();
                try { localStorage.setItem(DEEP_RESET_SUCCESS_TOAST_KEY, '1'); } catch {}
                // Clear status keys since process fully done
                try { localStorage.removeItem(DEEP_RESET_STATUS_KEY); localStorage.removeItem(DEEP_RESET_MINIMIZED_KEY); } catch {}
            }
        }
    } catch (err) {
        // Endpoint might not exist or not authorized on some pages – ignore silently
        // console.debug('Deep reset status check skipped:', err.message);
    }
}

// ================================
// Deep Reset UI helpers (phase, badge, styles, restart, success toast)
// ================================
function inferDeepResetPhase(status) {
    const steps = status.steps || [];
    const lastMsg = (steps[steps.length - 1]?.msg || '').toLowerCase();
    const mapping = [
        { key: 'truncate', label: 'Truncating', match: /(truncate|wipe|dropp?ing|clearing)/ },
        { key: 'cleanup', label: 'Cleanup', match: /(cleanup|cleaning|remov(ing|al)|pruning)/ },
        { key: 'discovery', label: 'Discovery', match: /(discover|harvest|extract|loading source)/ },
        { key: 'validation', label: 'Validation', match: /(validate|checking|verif(y|ication))/ },
        { key: 'rebuild', label: 'Rebuild Index', match: /(rebuild|index|snapshot|refresh)/ },
        { key: 'finalizing', label: 'Finalizing', match: /(finaliz|wrap|complete|finishing)/ },
    ];
    for (const m of mapping) { if (m.match.test(lastMsg)) return m; }
    return { key: 'progress', label: (status.state === 'queued' ? 'Queued' : 'Processing') };
}

function applyPhaseColor(phaseKey) {
    const el = document.getElementById('deep-reset-progress');
    if (!el) return;
    const palette = {
        truncate: ['#dc2626', '#f97316'],
        cleanup: ['#f97316', '#f59e0b'],
        discovery: ['#6366f1', '#0ea5e9'],
        validation: ['#16a34a', '#10b981'],
        rebuild: ['#06b6d4', '#2563eb'],
        finalizing: ['#7e22ce', '#ec4899'],
        progress: ['#ef4444', '#fb923c']
    };
    const colors = palette[phaseKey] || palette.progress;
    el.style.backgroundImage = `linear-gradient(100deg, ${colors[0]}, ${colors[1]})`;
}

function ensureDeepResetStyles() {
    if (document.getElementById('deep-reset-style')) return;
    const style = document.createElement('style');
    style.id = 'deep-reset-style';
    style.textContent = `
    @keyframes deepResetShimmer { from { background-position: 0 0; } to { background-position: 60px 0; } }
    #deep-reset-progress.deep-reset-bar { background-size: 60px 60px; animation: deepResetShimmer 1s linear infinite; }
    #deep-reset-status-bar.collapsed { opacity:0; pointer-events:none; transform: translate(-50%, 10px); }
    #deep-reset-badge { box-shadow: 0 4px 12px -2px rgba(0,0,0,0.25); }
    #deep-reset-badge:hover { transform: scale(1.05); }
    .deep-reset-fade-out { transition: opacity .5s ease, transform .5s ease; opacity:0; transform: translateY(8px); }
    .deep-reset-toast { animation: drToastSlide .45s ease; }
    @keyframes drToastSlide { from { transform: translate(-50%, 20px); opacity:0; } to { transform: translate(-50%,0); opacity:1; } }
    `;
    document.head.appendChild(style);
}

function setDeepResetMinimized(min) {
    const bar = document.getElementById('deep-reset-status-bar');
    if (!bar) return;
    try { localStorage.setItem(DEEP_RESET_MINIMIZED_KEY, min ? '1' : '0'); } catch {}
    if (min) {
        bar.style.display = 'none';
        createDeepResetBadge();
    } else {
        bar.style.display = 'block';
        const badge = document.getElementById('deep-reset-badge');
        if (badge) badge.remove();
    }
    const toggleBtn = bar.querySelector('#deep-reset-toggle');
    if (toggleBtn) toggleBtn.textContent = min ? 'Expand' : 'Minimize';
}

function createDeepResetBadge() {
    let badge = document.getElementById('deep-reset-badge');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'deep-reset-badge';
    badge.className = 'fixed bottom-3 right-3 bg-white border border-gray-300 rounded-full px-3 py-1 text-xs font-semibold text-gray-700 cursor-pointer z-50 flex items-center gap-2';
    badge.innerHTML = `
       <span class="inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-r from-red-500 to-orange-400 animate-pulse" id="deep-reset-badge-dot"></span>
       <span id="deep-reset-badge-text">Reset 0%</span>
    `;
    badge.addEventListener('mouseenter', () => setDeepResetMinimized(false));
    badge.addEventListener('click', () => setDeepResetMinimized(false));
    document.body.appendChild(badge);
    return badge;
}

function updateDeepResetBadge(pct) {
    const badge = document.getElementById('deep-reset-badge');
    if (!badge) return;
    const txt = badge.querySelector('#deep-reset-badge-text');
    if (txt) txt.textContent = `Reset ${pct.toFixed(0)}%`;
}

async function restartDeepReset() {
    try {
        if (!confirm('Restart the deep reset from the beginning?')) return;
        const btn = document.getElementById('deep-reset-retry');
        if (btn) { btn.textContent = 'Restarting...'; btn.disabled = true; }
        const resp = await fetchAPI('/admin/deep-reset', 'POST');
        if (resp.status !== 'accepted') throw new Error('Unexpected response');
        const bar = ensureDeepResetStatusBar();
        setDeepResetMinimized(false);
        startDeepResetPolling(null);
    } catch (e) {
        alert('Failed to restart deep reset: ' + e.message);
    }
}

function showDeepResetSuccessToast() {
    // If already shown (e.g., navigating quickly), skip duplication
    if (document.getElementById('deep-reset-success-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'deep-reset-success-toast';
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-3 rounded-lg shadow-xl font-semibold text-sm z-[60] deep-reset-toast';
    toast.innerHTML = '<span class="mr-2">✅</span> Overall Reset Complete';
    document.body.appendChild(toast);
    setTimeout(()=> { toast.classList.add('deep-reset-fade-out'); setTimeout(()=> toast.remove(), 600); }, 2000);
}

function fadeOutDeepResetUI() {
    const bar = document.getElementById('deep-reset-status-bar');
    const badge = document.getElementById('deep-reset-badge');
    if (bar) { bar.classList.add('deep-reset-fade-out'); setTimeout(()=> bar.remove(), 600); }
    if (badge) { badge.classList.add('deep-reset-fade-out'); setTimeout(()=> badge.remove(), 600); }
    try { localStorage.removeItem(DEEP_RESET_MINIMIZED_KEY); } catch {}
}

// Ensure deep reset styles exist early for any page that loads this script
ensureDeepResetStyles();
