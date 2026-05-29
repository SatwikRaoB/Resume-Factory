import os
import google.genai as genai
from google.genai import types

def generate_chat_response(api_key, job_description, resume_content, user_question, chat_history=[]):
    """
    Generates a response from Gemini based on the resume context and specific guidelines.
    """
    client = genai.Client(api_key=api_key)

    # Define the specific persona and guidelines provided by the user
    guidelines = """
    You are a professional career assistant helping the user with their tailored resume.
    
    CONTEXT:
    1. JOB DESCRIPTION: Provided below.
    2. TAILORED RESUME: Provided below (HTML format).
    
    GUIDELINES FOR SPECIFIC REQUESTS:
    
    1. If the User Asks for "Experience Descriptions":
       - Give a 150-word description summary of each job from the tailored resume.
       - NO bullet points.
       - Reflect the user's strengths, relevant skills, and job experience in a compelling way.
       - Humanize the summary.
       - Remember the user is currently working at BlackRock (if applicable based on resume).
       - Provide this in plain text, not HTML.
       - Do not make the experience description repetitive (e.g., don't mention project details in all descriptions).

    2. If the User Asks for "Cover Letter" or relevant application questions:
       - Reply based on the Job Description and Resume.
       - Focus on why the user wants this job and an accomplishment related to the job.
       - Be less "braggy," compelling, and humanized.
       - Organize answers well in the user's POV.
       - Provide in plain text, not HTML.
       - Answers should be short (1 paragraph), use simple English, sound natural, and be designed to pass GPTZero detection (more sentences, fewer commas, natural flow).

    GENERAL RULES:
    - Answer specific questions about the resume content or how it matches the JD.
    - Keep answers helpful and concise unless a specific format is requested.
    """

    # Construct the prompt
    prompt_content = f"""
    {guidelines}

    --- JOB DESCRIPTION ---
    {job_description}

    --- TAILORED RESUME CONTENT ---
    {resume_content}

    --- CHAT HISTORY ---
    {chat_history}

    --- USER QUESTION ---
    {user_question}
    """

    try:
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt_content)])],
            config=types.GenerateContentConfig(temperature=0.7)
        )
        return response.text
    except Exception as e:
        return f"Error generating response: {str(e)}"