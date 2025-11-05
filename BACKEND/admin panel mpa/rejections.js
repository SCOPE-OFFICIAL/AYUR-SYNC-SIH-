// This file contains the specific logic for the Rejections page.

async function initializePage() {
    // Set default sub-tab and cache DOM elements
    state.currentRejectedSubTab = 'correction';
    Object.assign(dom, {
        validationModal: document.getElementById('validation-modal'),
        confirmationTitle: document.getElementById('confirmation-title'),
        confirmationMessage: document.getElementById('confirmation-message'),
        confirmPromoteButton: document.getElementById('confirm-promote-button')
    });

    try {
        // Fetch all data needed for this page in parallel
        const [rejectedData, icdCodes, masterMap] = await Promise.all([
            fetchAPI('/admin/rejected-mappings'),
            fetchAPI('/admin/all-icd-codes-for-search'),
            fetchAPI('/admin/master-map-data') // Fetch master map to check destination status
        ]);
        state.data.rejected = rejectedData;
        state.allIcdCodes = icdCodes;
        state.data.master = masterMap; // Cache master map data
        renderRejectedPage();
    } catch (error) {
        dom.contentArea.innerHTML = `<p class="p-8 text-red-500">Error loading data: ${error.message}</p>`;
    } finally {
        dom.mainLoader.classList.add('hidden');
    }
}

// --- Main Rendering ---
function renderRejectedPage() {
    const correctionCount = state.data.rejected.needs_correction?.length || 0;
    const orphanageCount = state.data.rejected.no_mapping?.length || 0;
    const subTab = state.currentRejectedSubTab;

    let tableContent = '';
    if (subTab === 'correction') {
        tableContent = renderRejectedTable(state.data.rejected.needs_correction, false);
    } else {
        tableContent = renderRejectedTable(state.data.rejected.no_mapping, true);
    }

    const contentHtml = `
        <div class="p-4 border-b">
            <div class="inline-flex rounded-md shadow-sm">
                <button onclick="switchRejectedSubTab('correction')" class="sub-tab-button relative px-4 py-2 text-sm font-medium border rounded-l-lg ${subTab === 'correction' ? 'sub-tab-active' : 'bg-white hover:bg-gray-50'}">
                    Correction Queue <span class="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 bg-red-600 rounded-full">${correctionCount}</span>
                </button>
                <button onclick="switchRejectedSubTab('no_mapping')" class="sub-tab-button relative px-4 py-2 text-sm font-medium border-t border-b border-r rounded-r-lg ${subTab === 'no_mapping' ? 'sub-tab-active' : 'bg-white hover:bg-gray-50'}">
                    Orphanage <span class="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-blue-100 bg-blue-600 rounded-full">${orphanageCount}</span>
                </button>
            </div>
        </div>
        <div class="p-4">${tableContent}</div>
    `;
    dom.contentArea.innerHTML = contentHtml;
}

function renderRejectedTable(data, isOrphanage) {
    if (!data || data.length === 0) {
        return `<p class="text-center py-12 text-gray-500">This queue is empty.</p>`;
    }
    const rows = data.map((item, index) => createRejectedCard(item, isOrphanage, index)).join('');
    return `<div class="space-y-4">${rows}</div>`;
}

function createRejectedCard(item, isOrphanage, index) {
    const { original_icd_name, system, term, code, source_description, source_short_definition, source_long_definition, justification, confidence, devanagari, tamil, arabic } = item;

    // The container now holds the index and the button is moved inside for easier event handling
    const searchAndRemapHtml = `
        <div class="remap-container" data-item-index="${index}">
            <div>
                <label class="block text-sm font-medium text-gray-700">Assign to Correct ICD-11 Code</label>
                <div class="relative mt-1">
                    <input type="text" class="remap-search-input w-full p-2 border border-gray-300 rounded-md" 
                           onfocus="this.nextElementSibling.classList.remove('hidden')"
                           onblur="setTimeout(() => this.nextElementSibling.classList.add('hidden'), 200)"
                           onkeyup="handleIcdSearch(this)" 
                           onkeydown="handleSearchKeyDown(event, this)"
                           placeholder="Type to search or create new...">
                    <div class="search-dropdown absolute z-10 w-full bg-white border rounded-md mt-1 max-h-60 overflow-y-auto hidden shadow-lg text-sm">
                        </div>
                </div>
            </div>
            <div class="mt-4 border-t pt-4">
                <button disabled 
                        class="remap-button w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                        onclick="handleRemapConfirmation(this)">
                    Remap Term
                </button>
            </div>
        </div>
    `;

    return `
        <div class="bg-white p-4 rounded-lg shadow-sm border">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                    <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Rejected Term <span class="capitalize">(${system})</span></h4>
                    <div class="bg-gray-50 p-3 rounded-lg border space-y-2">
                        <p class="font-bold text-sm text-gray-800">${term} <span class="font-mono text-gray-500 text-xs">(${code})</span></p>
                        <p class="text-gray-500 text-sm">${devanagari || tamil || arabic || ''}</p>
                        <div class="pt-2 border-t">
                            <p class="text-[11px] text-gray-500 font-semibold uppercase">Source Short Def.</p>
                            <p class="text-xs text-gray-700">${(source_short_definition && String(source_short_definition).trim()) ? source_short_definition : 'Short definition is not available in source file'}</p>
                        </div>
                        <div>
                            <p class="text-[11px] text-gray-500 font-semibold uppercase">Source Long Def.</p>
                            <p class="text-xs text-gray-700">${(source_long_definition && String(source_long_definition).trim()) ? source_long_definition : 'Long definition is not available in source file'}</p>
                        </div>
                        <div>
                            <p class="text-[11px] text-gray-500 font-semibold uppercase">AI Justification</p>
                            <p class="text-xs text-gray-700">${(justification && String(justification).trim()) ? justification : 'N/A'}</p>
                        </div>
                        <div>
                            <p class="text-[11px] text-gray-500 font-semibold uppercase">AI Confidence</p>
                            <p class="text-xs text-gray-700">${(confidence !== undefined && confidence !== null && String(confidence).trim() !== '') ? `${confidence}%` : '0%'}</p>
                        </div>
                        <div>
                            <p class="text-[11px] text-gray-400">Legacy Source Description</p>
                            <p class="text-[11px] text-gray-500">${source_description || ''}</p>
                        </div>
                    </div>
                </div>
                <div>
                    <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Originally Mapped To</h4>
                    <p class="italic text-gray-600 text-sm p-3 bg-gray-50 rounded-lg border">${original_icd_name}</p>
                </div>
                ${isOrphanage ? '' : `<div class="col-span-full">${searchAndRemapHtml}</div>`}
            </div>
        </div>
    `;
}

// --- Event Handlers for Search & Remap ---

function handleIcdSearch(inputElement) {
    const dropdown = inputElement.nextElementSibling;
    const filter = inputElement.value.toLowerCase();
    
    if (!filter) {
        dropdown.innerHTML = '';
        return;
    }

    // Normalize the list so we always work with an array of strings. The
    // backend may return either plain strings (['A', 'B']) or objects
    // ([{icd_name: 'A'}, {suggested_icd_name: 'B'}]). Make the UI tolerant.
    const normalized = (state.allIcdCodes || []).map(item => {
        if (!item && item !== 0) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') return item.icd_name || item.suggested_icd_name || item.name || String(item);
        return String(item);
    });

    const filteredCodes = normalized.filter(code => code.toLowerCase().includes(filter));

    if (filteredCodes.length > 0) {
        dropdown.innerHTML = filteredCodes.map(code => 
            `<div class="p-2 hover:bg-gray-100 cursor-pointer" onmousedown="selectIcd(this)">${code}</div>`
        ).join('');
    } else {
        dropdown.innerHTML = `<div class="p-2 text-gray-500">ICD not found. Press Enter to add it.</div>`;
    }
}

function handleSearchKeyDown(event, inputElement) {
    if (event.key === 'Enter') {
        const dropdown = inputElement.nextElementSibling;
        if (dropdown.textContent.includes("ICD not found")) {
            event.preventDefault();
            handleCreateConfirmation(inputElement);
        }
    }
}

function selectIcd(divElement) {
    const container = divElement.closest('.relative');
    const input = container.querySelector('.remap-search-input');
    const remapContainer = container.closest('.remap-container');
    const button = remapContainer.querySelector('.remap-button');
    
    input.value = divElement.textContent;
    button.disabled = false;
    divElement.parentElement.classList.add('hidden');
}

// --- Confirmation and Action Logic ---

function handleRemapConfirmation(buttonElement) {
    const remapContainer = buttonElement.closest('.remap-container');
    const itemIndex = remapContainer.dataset.itemIndex;
    const rejectedItem = state.data.rejected.needs_correction[itemIndex];
    const destIcd = remapContainer.querySelector('.remap-search-input').value;

    const masterMapIcds = new Set((state.data.master || []).map(item => item.suggested_icd_name));
    
    let message = '';
    if (masterMapIcds.has(destIcd)) {
        const masterRow = state.data.master.find(r => r.suggested_icd_name === destIcd);
        const systemMapping = masterRow[`${rejectedItem.system}_mapping`];
        if (systemMapping && systemMapping !== '{}' && systemMapping !== '[]' && JSON.parse(systemMapping).primary) {
            message = `The ICD code <strong>"${destIcd}"</strong> already has a primary mapping for the <strong>${rejectedItem.system}</strong> system. This term will be added as an <strong>alias</strong>. Proceed?`;
        } else {
            message = `The ICD code <strong>"${destIcd}"</strong> has no primary mapping for the <strong>${rejectedItem.system}</strong> system. This term will be set as the <strong>new primary mapping</strong>. Proceed?`;
        }
    } else {
        message = `This term will be moved from rejections and added to the suggestions for <strong>"${destIcd}"</strong> for future review. Proceed?`;
    }

    showConfirmationModal(message, () => performRemap(rejectedItem, destIcd, false));
}

function handleCreateConfirmation(inputElement) {
    const remapContainer = inputElement.closest('.remap-container');
    const itemIndex = remapContainer.dataset.itemIndex;
    const rejectedItem = state.data.rejected.needs_correction[itemIndex];
    const newIcdName = inputElement.value;
    
    let message = `The ICD code <strong>"${newIcdName}"</strong> does not exist. Do you want to add it to the system?
                   <ul class="list-disc pl-5 mt-2 text-xs">
                     <li>The new disease will be added to the Master ICD-11 List.</li>
                     <li>The rejected term will be set as the <strong>new primary mapping</strong> for this disease.</li>
                     <li>It will be placed in the 'New Suggestions' workflow for final review.</li>
                   </ul>`;
                   
    showConfirmationModal(message, () => performRemap(rejectedItem, newIcdName, true), "Confirm & Create New");
}

async function performRemap(rejectedItem, destinationIcdName, isNewIcd) {
    const confirmButton = dom.confirmPromoteButton;
    toggleButtonLoading(confirmButton, true);
    
    const payload = {
        rejected_term_data: rejectedItem,
        destination_icd_name: destinationIcdName,
        is_new_icd: isNewIcd
    };

    try {
        await fetchAPI('/admin/remap-rejected-term', 'POST', payload);
        alert('Term successfully remapped!');
        window.location.reload();
    } catch (error) {
        alert(`Failed to remap term: ${error.message}`);
        toggleButtonLoading(confirmButton, false); // Keep modal open on error
    }
}

// --- Modal & Utility Functions ---

function showConfirmationModal(message, onConfirmCallback, confirmText = "Confirm") {
    dom.confirmationMessage.innerHTML = message;
    dom.confirmPromoteButton.querySelector('.btn-text').textContent = confirmText;
    dom.confirmPromoteButton.onclick = onConfirmCallback;
    dom.validationModal.classList.remove('hidden');
    dom.validationModal.classList.add('flex');
}

function closeValidationModal() {
    dom.validationModal.classList.add('hidden');
    dom.validationModal.classList.remove('flex');
}

function switchRejectedSubTab(subTab) {
    state.currentRejectedSubTab = subTab;
    renderRejectedPage();
}