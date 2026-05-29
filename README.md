# Resume Tailor AI – User Guide

## 📌 Introduction
Resume Tailor AI is a locally hosted automation tool that helps you tailor your resume for specific job descriptions using **Google Gemini AI**. It includes:

- A modern interactive dashboard  
- Automated PDF generation  
- A built‑in AI chat assistant  

---

## 📦 1. Prerequisites
Before installing, ensure you have:

- **Python 3.8+** — download from python.org  
- **VS Code** — recommended for editing your master resume  
- **Google Gemini API Key** — obtain from Google AI Studio  

---

## ⚙️ 2. Installation & Setup

### A. Folder Structure
Create a folder named `Resume_Tailor` with the following structure:

```
Resume_Tailor/
│── app.py
│── chat_service.py
│── requirements.txt
│── resume.css
│
├── templates/
│   ├── dashboard.html
│   └── configuration.html
│
└── static/
    ├── style.css
    └── dashboard.js
```

### B. Install Dependencies
Inside the `Resume_Tailor` folder:

```bash
pip install -r requirements.txt
```

Install the browser engine for PDF generation:

```bash
playwright install chromium
```

---

## 🚀 3. Running the Application

Start the app:

```bash
python app.py
```

You should see:

```
🚀 Resume Tailor running at http://127.0.0.1:5000
```

Open your browser and visit:

```
http://127.0.0.1:5000
```

---

## 🛠️ 4. Initial Configuration

On first launch:

1. Click the **⚙️ Gear Icon** in the top‑right corner.
2. **Gemini API Key** — paste your key.
3. **Output Directory** — defaults to `Generated_Resumes/`.
4. **Master Resume Data**  
   - Do **NOT** paste plain text.  
   - Open your original resume **HTML file** in VS Code.  
   - Copy the entire HTML code and paste it here.
5. **Gemini Instructions** — optional custom tailoring prompt.
6. Click **Save Configuration**.

---

## 📊 5. Using the Dashboard

### A. Tailoring a Resume
1. **Copy a Job Description** from LinkedIn, Indeed, etc.  
2. **Paste & Queue** — click *Add to Queue*.  
3. Watch the job appear in **Job Activity** with a shimmering “Gemini is tailoring…” status.  
   - When complete, it turns **green (Done)**.

---

### B. Reviewing & Editing

When a job is **Done**, you can:

- **Preview HTML** — opens a slide‑out preview drawer.  
- **Edit in VS Code** — opens the generated HTML file directly.  
- **Ask LLM** — opens a chat window for tasks like:  
  - “Write a cover letter for this job.”  
  - “What skills from the JD are missing in my resume?”

---

### C. Rewriting (If AI Missed Something)

Options include:

- **Retry** — re‑runs the same prompt.  
- **Refine (Advanced Rewrite)** — add custom instructions.  
- **Quick Suggestions** — chips like *Enhance Summary*, *Add Skills*, etc.  
- Click **Advanced Rewrite** to regenerate.

---

### D. Saving the PDF

- Click **Save PDF** (blue button).  
- **Shortcut:** Press **Shift + S** while preview drawer is open.

---

### E. Dark Mode

Toggle the **🌙 Moon Icon** to switch themes.  
The app remembers your preference.

---

## ❗ Troubleshooting

| Issue | Solution |
|-------|----------|
| **404 Not Found** | Check folder structure (`static/` and `templates/`). |
| **Gemini Error** | Verify API key in Configuration. |
| **Styles not loading** | Hard refresh (`Ctrl + Shift + R`) or restart the Python app. |

---
