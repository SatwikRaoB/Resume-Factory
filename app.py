import os
import json
import time
import shutil
import re
import subprocess
import base64
import tkinter as tk
from io import BytesIO
from tkinter import filedialog
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for, send_file, make_response
from google import genai
from google.genai import types
from playwright.sync_api import sync_playwright

# Import the chat service
import chat_service

app = Flask(__name__)

# --- CONFIGURATION ---
CONFIG_FILE = 'config.json'
HISTORY_FILE = 'history.json'
MASTER_CSS_FILE = 'resume.css'

DEFAULT_CONFIG = {
    "base_resume": "Paste your master resume here...",
    "gemini_instruction": "You are an expert resume writer. Tailor my resume to the job description.",
    "api_key": "",
    "save_directory": os.path.join(os.getcwd(), "Generated_Resumes"),
    "history_limit": 50
}

executor = ThreadPoolExecutor(max_workers=2)
job_queue = []
chat_sessions = {}

# --- CORS & HEADERS SETUP ---
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# --- HELPERS ---
def load_config():
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w') as f:
            json.dump(DEFAULT_CONFIG, f, indent=4)
        return DEFAULT_CONFIG
    with open(CONFIG_FILE, 'r') as f:
        data = json.load(f)
        if "save_directory" not in data:
            data["save_directory"] = DEFAULT_CONFIG["save_directory"]
        if "history_limit" not in data:
            data["history_limit"] = 50
        return data

def save_config_data(data):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(data, f, indent=4)

def load_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, 'r') as f:
            return json.load(f)
    except:
        return []

def save_to_history(job_data):
    history = load_history()
    config = load_config()
    limit = config.get('history_limit', 50)

    # Update if exists, otherwise append
    existing_index = next((index for (index, d) in enumerate(history) if d["id"] == job_data["id"]), None)
    
    # Prepare minimal record but KEEP JD
    record = {
        "id": job_data['id'],
        "title": job_data.get('filename', f"Job {job_data['id']}"),
        "filename": job_data['filename'],
        "preview": job_data['preview'],
        "text": job_data['text'], # Keeping JD is crucial for rewriting
        "timestamp": job_data['timestamp'],
        "status": "completed"
    }

    if existing_index is not None:
        history[existing_index] = record
        # Move to top
        history.insert(0, history.pop(existing_index))
    else:
        history.insert(0, record)
    
    # Prune
    if len(history) > limit:
        history = history[:limit]
        
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=4)

def extract_html_content(text):
    match = re.search(r"```html(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.replace("```", "").strip()

def ensure_css_in_target_dir(target_dir):
    if not os.path.exists(target_dir): os.makedirs(target_dir)
    target_css = os.path.join(target_dir, "resume.css")
    if os.path.exists(MASTER_CSS_FILE):
        if not os.path.exists(target_css):
            shutil.copy(MASTER_CSS_FILE, target_css)

def process_single_job(job_id, job_text):
    """Standard Processing Logic."""
    print(f"⚡ Processing Job #{job_id}...")
    for j in job_queue:
        if j['id'] == job_id:
            j['status'] = 'processing'
            break

    try:
        config = load_config()
        api_key = config.get('api_key')
        save_dir = config.get('save_directory')
        if not api_key: raise Exception("API Key missing")
        
        ensure_css_in_target_dir(save_dir)
        client = genai.Client(api_key=api_key)

        system_prompt = f'''
        {config['gemini_instruction']}
        IMPORTANT: Output ONLY valid HTML code inside <body> tags. Use standard HTML5 tags.
        --- MY BASE RESUME ---
        {config['base_resume']}
        '''

        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=f"JOB DESCRIPTION:\n{job_text}")])],
            config=types.GenerateContentConfig(system_instruction=[types.Part.from_text(text=system_prompt)], temperature=0.4)
        )

        response_text = response.text
        if not response_text and response.candidates:
            parts = response.candidates[0].content.parts
            response_text = "".join([p.text for p in parts if p.text])

        clean_body = extract_html_content(response_text)
        full_html = f'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Resume</title><link rel="stylesheet" href="resume.css"></head><body>{clean_body}</body></html>'

        job_entry = next((j for j in job_queue if j['id'] == job_id), None)
        html_filename = job_entry['filename'] if job_entry else f"job_{job_id}.html"
        
        file_path = os.path.join(save_dir, html_filename)
        with open(file_path, "w", encoding="utf-8") as f: f.write(full_html)

        for j in job_queue:
            if j['id'] == job_id:
                j['status'] = 'completed'
                j['full_path'] = file_path
                save_to_history(j) # Save to History on success

        print(f"✅ Job #{job_id} Saved.")

    except Exception as e:
        print(f"❌ Job #{job_id} Failed: {e}")
        for j in job_queue:
            if j['id'] == job_id:
                j['status'] = 'error'
                j['error'] = str(e)

def process_rewrite(job_id, mode, instructions=""):
    """Handles both Normal (Retry) and Advanced (Edit) rewrites."""
    print(f"🔄 Rewriting Job #{job_id} ({mode})...")
    
    job_entry = next((j for j in job_queue if j['id'] == job_id), None)
    if not job_entry: return

    # Update UI status
    job_entry['status'] = 'processing'

    try:
        config = load_config()
        api_key = config.get('api_key')
        save_dir = config.get('save_directory')
        
        client = genai.Client(api_key=api_key)
        
        # 1. Get current file content if needed
        current_html = ""
        file_path = os.path.join(save_dir, job_entry['filename'])
        
        # For advanced rewrite, we need the old file. If missing, treat as normal generation.
        if mode == 'advanced' and os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f: current_html = f.read()
        elif mode == 'advanced' and not os.path.exists(file_path):
            # Fallback if file missing
            mode = 'normal' 

        if mode == 'normal':
            # Just re-run the standard process logic directly
            system_prompt = f'''{config['gemini_instruction']}
            IMPORTANT: Output ONLY valid HTML code inside <body> tags.
            --- MY BASE RESUME ---
            {config['base_resume']}'''
            
            user_content = f"JOB DESCRIPTION:\n{job_entry['text']}"

        elif mode == 'advanced':
            # Context-aware edit
            system_prompt = f'''You are an expert HTML Resume Editor.
            Your task is to modify the existing resume HTML based strictly on the user's request.
            Maintain the existing CSS classes and structure. Output ONLY the updated HTML <body> content.'''
            
            user_content = f"""
            ORIGINAL JOB DESCRIPTION:
            {job_entry['text']}
            
            CURRENT HTML RESUME:
            {current_html}
            
            USER REQUEST FOR CHANGES:
            {instructions}
            """

        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=user_content)])],
            config=types.GenerateContentConfig(system_instruction=[types.Part.from_text(text=system_prompt)], temperature=0.7)
        )

        response_text = response.text
        if not response_text and response.candidates:
             parts = response.candidates[0].content.parts
             response_text = "".join([p.text for p in parts if p.text])

        clean_body = extract_html_content(response_text)
        full_html = f'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Resume</title><link rel="stylesheet" href="resume.css"></head><body>{clean_body}</body></html>'
        
        with open(file_path, "w", encoding="utf-8") as f: f.write(full_html)

        job_entry['status'] = 'completed'
        save_to_history(job_entry) # Update history
        print(f"✅ Job #{job_id} Rewritten.")

    except Exception as e:
        print(f"❌ Rewrite Failed: {e}")
        job_entry['status'] = 'error'
        job_entry['error'] = str(e)

# --- ROUTES ---
@app.route('/')
def home(): return redirect(url_for('dashboard'))
@app.route('/dashboard')
def dashboard(): return render_template('dashboard.html')
@app.route('/history')
def history_page(): return render_template('history.html')
@app.route('/configuration')
def configuration(): return render_template('configuration.html')

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    if request.method == 'POST':
        save_config_data(request.json)
        return jsonify({"status": "saved"})
    return jsonify(load_config())

@app.route('/api/queue/add', methods=['POST', 'OPTIONS'])
def add_to_queue():
    if request.method == 'OPTIONS': return jsonify({'status': 'ok'})
    data = request.get_json(force=True, silent=True) or request.form.to_dict()
    if not data: return jsonify({"error": "No data received"}), 400

    job_text = data.get('text') or data.get('jobDescription') or data.get('selection') or data.get('content')
    custom_name = data.get('title')
    
    if not job_text: return jsonify({"error": "No text/jobDescription found in request"}), 400
    
    job_id = int(time.time()) # Unique ID based on time
    filename = f"{re.sub(r'[\\/*?:\"<>|]', '', custom_name)}.html" if custom_name else f"job_{job_id}.html"
    if not filename.endswith('.html'): filename += ".html"

    new_job = {"id": job_id, "text": job_text, "preview": job_text[:60] + "...", "status": "pending", "timestamp": time.time(), "filename": filename}
    job_queue.append(new_job)
    executor.submit(process_single_job, job_id, job_text)
    
    print(f"📥 Added Job #{job_id} to queue")
    return jsonify({"status": "queued", "id": job_id})

@app.route('/api/job/rewrite', methods=['POST'])
def rewrite_job():
    data = request.json
    job_id = data.get('id')
    mode = data.get('mode') 
    instructions = data.get('instructions', '')
    
    # Check if job is in active queue
    job_entry = next((j for j in job_queue if j['id'] == job_id), None)
    
    if not job_entry:
        # If not in active queue, try to resurrect from history
        history = load_history()
        hist_entry = next((h for h in history if h['id'] == job_id), None)
        
        if hist_entry:
            print(f"♻️ Resurrecting Job #{job_id} from history...")
            job_entry = hist_entry.copy()
            job_entry['status'] = 'processing'
            job_queue.append(job_entry)
        else:
            return jsonify({"error": "Job not found in queue or history"}), 404

    # Mark as processing in queue
    job_entry['status'] = 'processing'
            
    executor.submit(process_rewrite, job_id, mode, instructions)
    return jsonify({"status": "started"})

@app.route('/api/queue/list', methods=['GET'])
def list_queue(): return jsonify(sorted(job_queue, key=lambda x: x['id'], reverse=True))

# --- HISTORY API ---
@app.route('/api/history', methods=['GET'])
def get_history_api():
    history = load_history()
    config = load_config()
    save_dir = config.get('save_directory')
    
    # Add file existence check
    for h in history:
        full_path = os.path.join(save_dir, h['filename'])
        h['file_exists'] = os.path.exists(full_path)
        
    return jsonify(history)

@app.route('/api/history/clear', methods=['POST'])
def clear_history_api():
    with open(HISTORY_FILE, 'w') as f:
        json.dump([], f)
    return jsonify({"status": "cleared"})

@app.route('/api/job/rename', methods=['POST'])
def rename_job():
    data = request.json
    job_id = data.get('id')
    new_name = data.get('new_name')
    new_name = re.sub(r'[\\/*?:"<>|]', "", new_name)
    if not new_name.endswith('.html'): new_name += ".html"
    config = load_config()
    save_dir = config.get('save_directory')
    
    # Handle both active queue and history
    targets = [j for j in job_queue if j['id'] == job_id]
    history = load_history()
    hist_target = next((h for h in history if h['id'] == job_id), None)
    
    if hist_target: targets.append(hist_target)
    
    if not targets: return jsonify({"error": "Job not found"}), 404
    
    try:
        # Rename actual file
        old_filename = targets[0]['filename']
        old_path = os.path.join(save_dir, old_filename)
        new_path = os.path.join(save_dir, new_name)
        
        if os.path.exists(old_path):
            if os.path.exists(new_path) and old_filename != new_name: return jsonify({"error": "File exists"}), 400
            os.rename(old_path, new_path)
        
        # Update references
        for t in targets: t['filename'] = new_name
        
        # Update persistent history if it was there
        if hist_target:
            with open(HISTORY_FILE, 'w') as f: json.dump(history, f, indent=4)
            
        return jsonify({"status": "renamed"})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/render_preview_pdf/<filename>')
def render_preview_pdf(filename):
    config = load_config()
    save_dir = config.get('save_directory')
    html_path = os.path.join(save_dir, filename)
    if not os.path.exists(html_path): return jsonify({"error": "HTML not found"}), 404
    try:
        file_url = f"file:///{os.path.abspath(html_path).replace(os.sep, '/')}"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(file_url)
            pdf_bytes = page.pdf(format="Letter", margin={"top":"0","bottom":"0","left":"0","right":"0"}, print_background=True)
            browser.close()
        return jsonify({"status": "success", "pdf_base64": base64.b64encode(pdf_bytes).decode('utf-8')})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/convert_pdf', methods=['POST'])
def convert_pdf():
    filename = request.json.get('filename')
    config = load_config()
    save_dir = config.get('save_directory')
    html_path = os.path.join(save_dir, filename)
    pdf_filename = filename.replace('.html', '.pdf')
    pdf_path = os.path.join(save_dir, pdf_filename)
    
    if not os.path.exists(html_path): 
        return jsonify({"error": "HTML not found"}), 404
        
    try:
        # 1. Attempt to remove existing PDF to force a fresh save
        if os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except PermissionError:
                # This catches the specific case where the file is open
                return jsonify({"error": "File is open/locked. Close PDF and try again."}), 400

        # 2. Generate new PDF
        file_url = f"file:///{os.path.abspath(html_path).replace(os.sep, '/')}"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(file_url)
            page.pdf(path=pdf_path, format="Letter", margin={"top":"0","bottom":"0","left":"0","right":"0"}, print_background=True)
            browser.close()
            
        return jsonify({"status": "success", "pdf_file": pdf_filename})
    except Exception as e: 
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/concurrency', methods=['POST'])
def set_concurrency():
    global executor
    workers = int(request.json.get('workers', 2))
    executor = ThreadPoolExecutor(max_workers=workers)
    return jsonify({"status": "updated", "workers": workers})

@app.route('/add_job', methods=['POST', 'OPTIONS'])
def extension_endpoint():
    # CORS check for extension
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'})
    return add_to_queue()

@app.route('/ping', methods=['GET'])
def ping(): return jsonify({"status": "alive"})
@app.route('/view/<path:filename>')
def view_file(filename):
    config = load_config()
    return send_from_directory(config.get('save_directory'), filename)
@app.route('/api/open_vscode', methods=['POST'])
def open_vscode():
    filename = request.json.get('filename')
    config = load_config()
    full_path = os.path.join(config.get('save_directory'), filename)
    try:
        if os.name == 'nt': subprocess.Popen(['code', full_path], shell=True)
        else: subprocess.Popen(['code', full_path])
        return jsonify({"status": "opened"})
    except Exception as e: return jsonify({"error": str(e)}), 500
@app.route('/api/browse_folder', methods=['POST'])
def browse_folder():
    try:
        root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
        path = filedialog.askdirectory(); root.destroy()
        return jsonify({"path": path}) if path else (jsonify({"error": "No folder"}), 400)
    except Exception as e: return jsonify({"error": str(e)}), 500

# --- CHAT ROUTES ---
@app.route('/api/chat/ask', methods=['POST'])
def chat_ask():
    data = request.json
    job_id = data.get('job_id')
    question = data.get('question')
    
    if not job_id or not question:
        return jsonify({"error": "Missing job_id or question"}), 400

    # Find the job details
    job_entry = next((j for j in job_queue if j['id'] == job_id), None)
    if not job_entry:
        return jsonify({"error": "Job not found"}), 404

    config = load_config()
    save_dir = config.get('save_directory')
    file_path = os.path.join(save_dir, job_entry['filename'])
    
    resume_content = ""
    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            resume_content = f.read()
    else:
        return jsonify({"error": "Resume file not generated yet"}), 404

    # Get/Init History
    if job_id not in chat_sessions:
        chat_sessions[job_id] = []
    
    # Call Chat Service
    try:
        answer = chat_service.generate_chat_response(
            api_key=config.get('api_key'),
            job_description=job_entry.get('text', ''),
            resume_content=resume_content,
            user_question=question,
            chat_history=chat_sessions[job_id]
        )
        
        # Update History
        chat_sessions[job_id].append({"role": "user", "content": question})
        chat_sessions[job_id].append({"role": "model", "content": answer})
        
        return jsonify({"answer": answer})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/chat/history/<int:job_id>', methods=['GET'])
def chat_history(job_id):
    return jsonify(chat_sessions.get(job_id, []))

if __name__ == '__main__':
    if not os.path.exists("Generated_Resumes"): os.makedirs("Generated_Resumes")
    if not os.path.exists(MASTER_CSS_FILE):
        with open(MASTER_CSS_FILE, 'w') as f: f.write("body { font-family: sans-serif; margin: 0; }")
    print("🚀 Resume Tailor running at [http://127.0.0.1:5000](http://127.0.0.1:5000)")
    app.run(debug=False, port=5000, threaded=True, use_reloader=False)