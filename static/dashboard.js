// --- INITIALIZATION ---
window.onload = function () {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    refreshData();
    // Start polling - Only refresh if user is NOT interacting
    setInterval(() => {
        if (!isInteracting) refreshData();
    }, 1500);

    // Keyboard Shortcut for Save PDF (Shift + S)
    document.addEventListener('keydown', function (e) {
        if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
            const drawer = document.getElementById('previewDrawer');
            if (drawer && !drawer.classList.contains('translate-x-full')) {
                if (activePreviewFilename && activePreviewJobId) {
                    e.preventDefault();
                    const btnId = `pdf-${activePreviewJobId}`;
                    savePdf(activePreviewFilename, btnId, activePreviewJobId);
                }
            }
        }
    });
};

let currentJobId = null;
let chatJobId = null;
let previousData = [];
let activePreviewFilename = null;
let activePreviewJobId = null;
let isInteracting = false;

// --- HELPER: PDF SAVED STATE ---
function getSavedJobs() {
    const saved = localStorage.getItem('saved_pdf_jobs');
    return saved ? JSON.parse(saved) : [];
}

function markJobAsSaved(id) {
    const saved = getSavedJobs();
    if (!saved.includes(id)) {
        saved.push(id);
        localStorage.setItem('saved_pdf_jobs', JSON.stringify(saved));
    }
}

// --- PDF RENDERER ---
async function renderPdfFromUrl(url) {
    const container = document.getElementById('pdf-canvas-container');
    const spinner = document.getElementById('loadingSpinner');
    const empty = document.getElementById('emptyState');
    container.innerHTML = '';
    empty.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const pdfData = atob(data.pdf_base64);
        const uint8Array = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) uint8Array[i] = pdfData.charCodeAt(i);

        const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
        const pdf = await loadingTask.promise;
        spinner.classList.add('hidden');

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const scale = 1.5;
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.className = 'pdf-page';
            container.appendChild(canvas);
            await page.render({ canvasContext: context, viewport: viewport }).promise;
        }
    } catch (error) {
        spinner.classList.add('hidden');
        container.innerHTML = `<p class="text-red-500 mt-10 font-medium">Failed to render PDF.</p>`;
    }
}

// --- REWRITE LOGIC ---
function openRewriteModal(id) {
    currentJobId = id;
    document.getElementById('rewriteModal').classList.remove('hidden');
    document.getElementById('advancedInput').classList.add('hidden');
}
function closeRewriteModal() { document.getElementById('rewriteModal').classList.add('hidden'); }
function showAdvanced() { document.getElementById('advancedInput').classList.remove('hidden'); }

async function triggerRewrite(mode, idOverride = null) {
    isInteracting = true;
    const targetId = idOverride || currentJobId;
    const instr = document.getElementById('rewriteInstructions').value;

    if (!idOverride) closeRewriteModal();

    // Reset saved status on rewrite
    const saved = getSavedJobs();
    const newSaved = saved.filter(id => id !== targetId);
    localStorage.setItem('saved_pdf_jobs', JSON.stringify(newSaved));

    try {
        await fetch('/api/job/rewrite', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: targetId, mode: mode, instructions: instr })
        });
    } finally {
        isInteracting = false;
        refreshData(true); // Force refresh to show processing state
    }
}

// --- CHAT LOGIC ---
async function openChat(id) {
    chatJobId = id;
    document.getElementById('chatModal').classList.remove('hidden');
    const container = document.getElementById('chatMessages');
    container.innerHTML = '<div class="text-center text-gray-400 text-xs mt-4 mb-4"><p>Loading history...</p></div>';
    try {
        const res = await fetch(`/api/chat/history/${id}`);
        const history = await res.json();
        container.innerHTML = '<div class="text-center text-gray-400 text-xs mt-4 mb-4"><p>Ask questions about this specific job & resume.</p></div>';
        history.forEach(msg => appendChatMessage(msg.role === 'user' ? 'user' : 'bot', msg.content));
        scrollToBottom();
    } catch (e) {
        container.innerHTML = '<div class="text-center text-red-400 text-xs mt-4"><p>Could not load history.</p></div>';
    }
}
function closeChatModal() { document.getElementById('chatModal').classList.add('hidden'); chatJobId = null; }
function appendChatMessage(sender, text) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `chat-msg ${sender === 'user' ? 'chat-msg-user' : 'chat-msg-bot'}`;
    div.innerHTML = text.replace(/\n/g, '<br>');
    container.appendChild(div);
    scrollToBottom();
}
function scrollToBottom() { const c = document.getElementById('chatMessages'); c.scrollTop = c.scrollHeight; }
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !chatJobId) return;
    input.value = '';
    appendChatMessage('user', text);
    const btn = document.getElementById('chatSendBtn'); btn.disabled = true;
    try {
        const res = await fetch('/api/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: chatJobId, question: text }) });
        const data = await res.json();
        appendChatMessage('bot', data.error ? `Error: ${data.error}` : data.answer);
    } catch (e) { appendChatMessage('bot', "Network error. Please try again."); }
    finally { btn.disabled = false; }
}

// --- PREVIEW LOGIC ---
async function openPreview(filename, jobId) {
    activePreviewFilename = filename;
    activePreviewJobId = jobId;
    const overlay = document.getElementById('drawerOverlay');
    const drawer = document.getElementById('previewDrawer');
    document.getElementById('previewLabel').innerText = filename.replace('.html', '.pdf');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    drawer.classList.remove('translate-x-full');
    await renderPdfFromUrl(`/api/render_preview_pdf/${filename}?t=${Date.now()}`);
}
function closePreview() {
    const overlay = document.getElementById('drawerOverlay');
    const drawer = document.getElementById('previewDrawer');
    drawer.classList.add('translate-x-full');
    overlay.classList.add('opacity-0');
    setTimeout(() => { overlay.classList.add('hidden'); document.getElementById('pdf-canvas-container').innerHTML = ''; }, 300);
    activePreviewFilename = null; activePreviewJobId = null;
}

// --- QUEUE LOGIC ---
async function addToQueue() {
    const text = document.getElementById('jdInput').value;
    if (!text) { alert("Please enter job description text."); return; }
    const btn = document.querySelector('button[onclick="addToQueue()"]');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
    btn.disabled = true;
    isInteracting = true;

    try {
        const response = await fetch('/api/queue/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) });
        if (!response.ok) throw new Error("Server rejected request");
        document.getElementById('jdInput').value = "";
    } catch (e) { alert("Failed to add to queue: " + e.message); }
    finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        isInteracting = false;
        refreshData(true); // Force refresh
    }
}

async function renameJob(id) {
    const val = document.getElementById(`rename-${id}`).value;
    if (!val) return;
    await fetch('/api/job/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, new_name: val }) });
    refreshData(true);
}

async function savePdf(filename, btnId, jobId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    isInteracting = true; // Stop polling
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/convert_pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: filename }) });
        const data = await res.json();

        if (res.ok) {
            markJobAsSaved(jobId);

            // Visual feedback
            btn.innerHTML = '<i class="fas fa-check"></i> Saved';
            btn.style.backgroundColor = '#059669';
            btn.style.borderColor = '#059669';
            btn.style.color = 'white';

            setTimeout(() => {
                isInteracting = false; // Resume polling
                // Force refresh so the main loop picks up the "Saved" state from localStorage
                refreshData(true);
            }, 1500);
        } else {
            throw new Error(data.error || "Error saving");
        }
    } catch (e) {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        isInteracting = false;
        alert(e.message);
    }
}

async function openVsCode(filename) {
    await fetch('/api/open_vscode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: filename }) });
}

async function updateConcurrency() {
    await fetch('/api/settings/concurrency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workers: document.getElementById('concurrencySelector').value }) });
}

async function refreshData(force = false) {
    try {
        const res = await fetch('/api/queue/list');
        const jobs = await res.json();

        // Skip update if data hasn't changed AND we aren't forcing it
        if (!force && JSON.stringify(jobs) === JSON.stringify(previousData)) return;

        previousData = jobs;

        document.getElementById('activeCount').innerText = jobs.length;
        const list = document.getElementById('jobList');

        if (jobs.length === 0) {
            list.innerHTML = `<div class="text-center py-12 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl opacity-60"><p class="text-gray-500 dark:text-gray-400">Queue is empty</p></div>`;
            return;
        }

        const savedJobs = getSavedJobs();

        list.innerHTML = jobs.map((job, index) => {
            const rawName = job.filename ? job.filename.replace('.html', '') : `job_${job.id}`;
            const isSaved = savedJobs.includes(job.id);
            const displayId = index + 1;

            let statusBadge = `<span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Pending</span>`;

            if (job.status === 'processing') {
                statusBadge = `<span class="gemini-text-effect flex items-center gap-2"><i class="fas fa-sparkles fa-spin"></i> Gemini is tailoring...</span>`;
            } else if (job.status === 'completed') {
                if (isSaved) {
                    statusBadge = `<span class="badge-done"><i class="fas fa-check mr-1"></i> Done</span>`;
                } else {
                    statusBadge = `<span class="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-100 dark:border-blue-800 uppercase">Ready to Review</span>`;
                }
            } else if (job.status === 'error') {
                statusBadge = `<span class="bg-red-50 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase border border-red-100">Error</span>`;
            }

            if (job.status === 'error') {
                return `
                <div class="card-container transition hover:shadow-md border-red-200 dark:border-red-900">
                    <div class="flex justify-between items-start mb-1">
                        <div class="flex items-center gap-2">
                            <span class="bg-slate-700 text-white dark:bg-white dark:text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">#${displayId}</span>
                            <span class="text-xs font-bold text-red-500 uppercase tracking-wide">GENERATION FAILED</span>
                        </div>
                        ${statusBadge}
                    </div>
                    <div class="mt-2 text-red-500 text-xs font-mono bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-100 dark:border-red-800 mb-3">${job.error}</div>
                    <button onclick="triggerRewrite('normal', ${job.id})" class="btn-base bg-red-100 text-red-700 hover:bg-red-200 border border-red-200 w-full justify-center">
                        <i class="fas fa-sync-alt"></i> Retry Generation
                    </button>
                </div>`;
            }

            let content = `<p class="text-xs font-mono text-gray-400 mt-3 truncate">${job.preview}</p>`;

            if (job.status === 'completed') {
                const saveBtnClass = isSaved
                    ? 'btn-pdf bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white'
                    : 'btn-pdf';

                const saveBtnText = isSaved
                    ? '<i class="fas fa-check-circle"></i> Saved PDF'
                    : '<i class="fas fa-file-pdf"></i> Save PDF';

                content = `
                <div class="mt-4">
                    <div class="flex justify-between items-end mb-1">
                        <label class="badge-label">FILENAME</label>
                    </div>
                    <div class="input-group">
                        <input id="rename-${job.id}" value="${rawName}" class="input-field" onkeydown="if(event.key==='Enter') renameJob(${job.id})">
                        <div class="input-suffix">.html</div>
                        <button id="btn-save-${job.id}" onclick="renameJob(${job.id})" class="btn-icon-green" title="Save Name">
                            <i class="fas fa-save text-sm"></i>
                        </button>
                    </div>

                    <div class="actions-row">
                        <button onclick="openPreview('${job.filename}', ${job.id})" class="btn-preview">
                            <i class="fas fa-external-link-alt"></i> Preview HTML
                        </button>
                        <button onclick="openVsCode('${job.filename}')" class="btn-vscode">
                            <i class="fas fa-code"></i> Edit in VS Code
                        </button>
                        <button onclick="openChat(${job.id})" class="btn-chat">
                            <i class="fas fa-comments"></i> Ask LLM
                        </button>
                        
                        <button onclick="openRewriteModal(${job.id})" class="btn-rewrite">
                            <i class="fas fa-redo"></i> Rewrite
                        </button>
                        
                        <button id="pdf-${job.id}" onclick="savePdf('${job.filename}', 'pdf-${job.id}', ${job.id})" class="${saveBtnClass}" style="${isSaved ? 'background-color: #059669; border-color: #059669;' : ''}">
                            ${saveBtnText}
                        </button>
                    </div>
                </div>
                `;
            }

            return `
            <div class="card-container transition hover:shadow-md">
                <div class="flex justify-between items-start mb-1">
                    <div class="flex items-center gap-2">
                        <span class="bg-slate-700 text-white dark:bg-white dark:text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">#${displayId}</span>
                        <span class="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide">JOB APPLICATION</span>
                    </div>
                    ${statusBadge}
                </div>
                ${content}
            </div>`;
        }).join('');
    } catch (e) { }
}