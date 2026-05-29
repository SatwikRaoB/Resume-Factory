window.onload = function () {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    loadHistory();

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
let activePreviewFilename = null;
let activePreviewJobId = null;

// --- HELPER: PDF SAVED STATE (Same as dashboard) ---
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

// --- HISTORY DATA ---
async function loadHistory(force = false) {
    const list = document.getElementById('historyList');
    try {
        const res = await fetch('/api/history');
        const jobs = await res.json();

        if (jobs.length === 0) {
            list.innerHTML = `<div class="text-center py-12 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl opacity-60"><p class="text-gray-500 dark:text-gray-400">No history found</p></div>`;
            return;
        }

        const savedJobs = getSavedJobs();

        list.innerHTML = jobs.map((job, index) => {
            const rawName = job.filename ? job.filename.replace('.html', '') : `job_${job.id}`;
            const isSaved = savedJobs.includes(job.id);
            const missingFile = !job.file_exists;
            const displayId = index + 1;

            // Buttons logic
            let actionButtons = '';
            if (missingFile) {
                actionButtons = `
                    <div class="text-red-500 text-xs font-bold flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded mb-2 border border-red-100 dark:border-red-800">
                        <i class="fas fa-exclamation-triangle"></i> File Deleted from Disk
                    </div>
                    <div class="actions-row opacity-50 pointer-events-none">
                        <button class="btn-preview">Preview HTML</button>
                        <button class="btn-vscode">Edit</button>
                        <button class="btn-chat">Ask LLM</button>
                    </div>
                    <div class="mt-3">
                        <button onclick="openRewriteModal(${job.id})" class="btn-rewrite w-full justify-center">
                            <i class="fas fa-redo"></i> Rewrite to Regenerate
                        </button>
                    </div>
                `;
            } else {
                const saveBtnClass = isSaved ? 'btn-pdf bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white' : 'btn-pdf';
                const saveBtnText = isSaved ? '<i class="fas fa-check-circle"></i> Saved PDF' : '<i class="fas fa-file-pdf"></i> Save PDF';

                actionButtons = `
                <div class="actions-row">
                    <button onclick="openPreview('${job.filename}', ${job.id})" class="btn-preview"><i class="fas fa-external-link-alt"></i> Preview</button>
                    <button onclick="openVsCode('${job.filename}')" class="btn-vscode"><i class="fas fa-code"></i> Edit</button>
                    <button onclick="openChat(${job.id})" class="btn-chat"><i class="fas fa-comments"></i> Ask LLM</button>
                    <button onclick="openRewriteModal(${job.id})" class="btn-rewrite"><i class="fas fa-redo"></i> Rewrite</button>
                    <button id="pdf-${job.id}" onclick="savePdf('${job.filename}', 'pdf-${job.id}', ${job.id})" class="${saveBtnClass}" style="${isSaved ? 'background-color: #059669; border-color: #059669;' : ''}">
                        ${saveBtnText}
                    </button>
                </div>`;
            }

            return `
            <div class="card-container transition hover:shadow-md">
                <div class="flex justify-between items-start mb-1">
                    <div class="flex items-center gap-2">
                        <!-- High Contrast Box for ID -->
                        <span class="bg-slate-700 text-white dark:bg-white dark:text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">#${displayId}</span>
                        <span class="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide">HISTORY</span>
                    </div>
                    <span class="text-[10px] text-gray-400 font-mono">${new Date(job.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <p class="text-xs font-mono text-gray-400 mt-3 truncate">${job.preview}</p>
                
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
                    ${actionButtons}
                </div>
            </div>`;
        }).join('');

    } catch (e) { console.log(e); }
}

async function clearHistory() {
    if (confirm("Are you sure you want to clear all history? Files on disk will NOT be deleted.")) {
        await fetch('/api/history/clear', { method: 'POST' });
        loadHistory(true);
    }
}

// --- SHARED LOGIC (Reused) ---
function openRewriteModal(id) {
    currentJobId = id;
    document.getElementById('rewriteModal').classList.remove('hidden');
    document.getElementById('advancedInput').classList.add('hidden');
}
function closeRewriteModal() { document.getElementById('rewriteModal').classList.add('hidden'); }
function showAdvanced() { document.getElementById('advancedInput').classList.remove('hidden'); }
function appendPrompt(text) {
    const input = document.getElementById('rewriteInstructions');
    const currentVal = input.value.trim();
    if (currentVal.length > 0) { input.value = currentVal + ", " + text; }
    else { input.value = text; }
    input.focus();
}

async function triggerRewrite(mode) {
    const instr = document.getElementById('rewriteInstructions').value;
    closeRewriteModal();
    // History rewrite actually creates a new job in the queue
    await fetch('/api/job/rewrite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentJobId, mode: mode, instructions: instr })
    });
    window.location.href = '/dashboard';
}

async function openPreview(filename, jobId) {
    activePreviewFilename = filename; activePreviewJobId = jobId;
    const overlay = document.getElementById('drawerOverlay');
    const drawer = document.getElementById('previewDrawer');
    document.getElementById('previewLabel').innerText = filename.replace('.html', '.pdf');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    drawer.classList.remove('translate-x-full');

    const container = document.getElementById('pdf-canvas-container');
    const spinner = document.getElementById('loadingSpinner');
    const empty = document.getElementById('emptyState');
    container.innerHTML = ''; empty.classList.add('hidden'); spinner.classList.remove('hidden');

    try {
        const res = await fetch(`/api/render_preview_pdf/${filename}?t=${Date.now()}`);
        const data = await res.json();
        const pdfData = atob(data.pdf_base64);
        const uint8Array = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) uint8Array[i] = pdfData.charCodeAt(i);
        const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
        const pdf = await loadingTask.promise;
        spinner.classList.add('hidden');
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height; canvas.width = viewport.width;
            canvas.className = 'pdf-page';
            container.appendChild(canvas);
            await page.render({ canvasContext: context, viewport: viewport }).promise;
        }
    } catch (error) { spinner.classList.add('hidden'); container.innerHTML = `<p class="text-red-500">Failed</p>`; }
}
function closePreview() {
    document.getElementById('drawerOverlay').classList.add('hidden');
    document.getElementById('previewDrawer').classList.add('translate-x-full');
}

async function openChat(id) {
    chatJobId = id;
    document.getElementById('chatModal').classList.remove('hidden');
    const container = document.getElementById('chatMessages');
    try {
        const res = await fetch(`/api/chat/history/${id}`);
        const history = await res.json();
        container.innerHTML = '<div class="text-center text-gray-400 text-xs mt-4 mb-4"><p>Ask questions about this specific job & resume.</p></div>';
        history.forEach(msg => {
            const div = document.createElement('div');
            div.className = `chat-msg ${msg.role === 'user' ? 'chat-msg-user' : 'chat-msg-bot'}`;
            div.innerHTML = msg.content.replace(/\n/g, '<br>');
            container.appendChild(div);
        });
    } catch (e) { }
}
function closeChatModal() { document.getElementById('chatModal').classList.add('hidden'); }
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div'); div.className = 'chat-msg chat-msg-user'; div.innerText = text; container.appendChild(div);

    const res = await fetch('/api/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: chatJobId, question: text }) });
    const data = await res.json();
    const divBot = document.createElement('div'); divBot.className = 'chat-msg chat-msg-bot'; divBot.innerHTML = (data.answer || data.error).replace(/\n/g, '<br>'); container.appendChild(divBot);
    container.scrollTop = container.scrollHeight;
}

async function renameJob(id) {
    const val = document.getElementById(`rename-${id}`).value;
    await fetch('/api/job/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, new_name: val }) });
    loadHistory(true);
}

async function savePdf(filename, btnId, jobId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const res = await fetch('/api/convert_pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: filename }) });
        const data = await res.json();

        if (res.ok) {
            markJobAsSaved(jobId);
            // Visual Feedback
            btn.innerHTML = '<i class="fas fa-check"></i> Saved';
            btn.style.backgroundColor = '#059669';
            btn.style.borderColor = '#059669';
            btn.style.color = 'white';
            setTimeout(() => { loadHistory(true); }, 1500);
        } else {
            throw new Error(data.error || "Error saving");
        }
    } catch (e) {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        alert(e.message);
    }
}

async function openVsCode(f) { await fetch('/api/open_vscode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f }) }); }