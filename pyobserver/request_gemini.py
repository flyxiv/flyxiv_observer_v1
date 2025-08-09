import google.generativeai as genai
import os
from enum import Enum

# Load API key from environment variable or config file
def get_gemini_api_key():
    return os.getenv('GEMINI_API_KEY')

gemini_api_key = get_gemini_api_key()
    
class GeminiModels(Enum):
    GEMINI_2_5_FLASH_LITE = "gemini-2.5-flash-lite"
    GEMINI_2_5_FLASH = "gemini-2.5-flash"
    GEMINI_2_5_PRO = "gemini-2.5-pro"

def request_gemini(model: GeminiModels, prompt, image_url=None):
    genai.configure(api_key=gemini_api_key)

    model = genai.GenerativeModel(model.value)

    if image_url:
        response = model.generate_content(prompt, image_url)
    else:
        response = model.generate_content(prompt)

    return response
