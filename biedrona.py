

import requests
from bs4 import BeautifulSoup
import re
from PIL import Image
import pytesseract
from io import BytesIO
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv # Nowa biblioteka do bezpiecznych haseł

# --- KONFIGURACJA ---
# Ładujemy zmienne z pliku .env (jeśli istnieje)
load_dotenv() 

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

KEYWORD_TO_FIND = "papier" 
SAVE_FOLDER = "gazetki"
MAX_WORKERS = 5

# Pobieramy URL bezpiecznie ze zmiennych środowiskowych
DISCORD_URL = os.getenv("DISCORD_WEBHOOK_URL")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

print_lock = threading.Lock()

# --------------------

def send_discord_notification(message, image_path):
    """Wysyła powiadomienie na Discorda (tekst + zdjęcie)."""
    if not DISCORD_URL:
        return # Jeśli nie ma linku w .env, nic nie rób

    try:
        data = {"content": message}
        # Otwieramy plik w trybie binarnym do wysłania
        with open(image_path, 'rb') as f:
            files = {
                "file": (os.path.basename(image_path), f)
            }
            response = requests.post(DISCORD_URL, data=data, files=files)
            
            # Sprawdzenie czy Discord przyjął wiadomość (kody 2xx są ok)
            if response.status_code not in [200, 204]:
                with print_lock:
                    print(f"\n⚠️ Błąd wysyłania na Discorda: {response.status_code}")
    except Exception as e:
        with print_lock:
            print(f"\n⚠️ Błąd funkcji Discorda: {e}")

def sanitize_filename(name):
    name = name.replace(" ", "_")
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    return name[:100]

def get_all_leaflet_uuids():
    main_page_url = "https://www.biedronka.pl/pl/gazetki"
    print(f"🔎 KROK 1: Wchodzę na stronę główną: {main_page_url}...")
    
    try:
        response = requests.get(main_page_url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        leaflet_links = soup.find_all('a', href=re.compile(r'/pl/press,id,'))
        unique_links = list(set([link.get('href') for link in leaflet_links]))
        
        if not unique_links:
            print("❌ Nie znaleziono linków. Strona mogła się zmienić.")
            return []
        
        print(f"✅ Znaleziono {len(unique_links)} gazetek. Rozpoczynam namierzanie ID...")

        long_ids = set()
        for i, link in enumerate(unique_links):
            full_url = link if link.startswith("http") else f"https://www.biedronka.pl{link}"
            try:
                page_resp = requests.get(full_url, headers=HEADERS, timeout=10)
                match = re.search(r'window\.galleryLeaflet\.init\("([a-f0-9\-]{36})"\)', page_resp.text)
                if match:
                    long_ids.add(match.group(1))
            except:
                pass
        
        return list(long_ids)

    except Exception as e:
        print(f"❌ Błąd krytyczny: {e}")
        return []

def get_leaflet_pages(leaflet_id):
    try:
        api_url = f"https://leaflet-api.prod.biedronka.cloud/api/leaflets/{leaflet_id}?ctx=web"
        response = requests.get(api_url, headers=HEADERS, timeout=10)
        data = response.json()
        
        pages_info = []
        name = data.get('name', f'Gazetka_{leaflet_id}')
        
        for page_data in data.get('images_desktop', []):
            valid_images = [img for img in page_data.get('images', []) if img]
            if valid_images:
                pages_info.append({
                    "leaflet_name": name,
                    "page_number": page_data.get('page') + 1,
                    "url": valid_images[0]
                })
        return name, pages_info
    except:
        return "Nieznana", []

def process_page(task_data):
    url = task_data['url']
    name = task_data['leaflet_name']
    page = task_data['page_number']
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        content = resp.content
        
        img = Image.open(BytesIO(content))
        text = pytesseract.image_to_string(img, lang='pol')
        
        if KEYWORD_TO_FIND.lower() in text.lower():
            safe_name = sanitize_filename(name)
            filename = f"{safe_name}_strona_{page}.png"
            path = os.path.join(SAVE_FOLDER, filename)
            
            with open(path, 'wb') as f:
                f.write(content)
            
            # Zwracamy więcej danych, żeby Main mógł wysłać Discorda
            msg = f"🔥 ZNALEZIONO PROMOCJĘ! Gazetka: '{name}' (Str. {page})"
            return True, msg, path 
        
        return False, None, None

    except Exception:
        return False, None, None

def main():
    os.makedirs(SAVE_FOLDER, exist_ok=True)
    print("="*60)
    print(f"   START SYSTEMU WYSZUKIWANIA PROMOCJI: '{KEYWORD_TO_FIND}'")
    print(f"   Folder zapisu: {os.path.abspath(SAVE_FOLDER)}")
    
    if DISCORD_URL:
        print("   ✅ Wykryto konfigurację Discord Webhook.")
    else:
        print("   ℹ️ Brak konfiguracji Discord (plik .env). Powiadomienia wyłączone.")
        
    print("="*60 + "\n")

    # 1. Zbieranie ID
    uuids = get_all_leaflet_uuids()
    if not uuids: return

    # 2. Zbieranie stron
    all_tasks = []
    print(f"\n📂 KROK 2: Przygotowuję listę stron do sprawdzenia:")
    for uuid in uuids:
        name, pages = get_leaflet_pages(uuid)
        if pages:
            print(f"   📄 {name[:50]:<50} ... ma {len(pages)} stron")
            all_tasks.extend(pages)
    
    total_pages = len(all_tasks)
    print(f"\n🚀 KROK 3: URUCHAMIAM TURBO SKANOWANIE ({MAX_WORKERS} wątki na raz)")
    
    processed = 0
    found_count = 0
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_task = {executor.submit(process_page, task): task for task in all_tasks}
        
        for future in as_completed(future_to_task):
            task = future_to_task[future]
            processed += 1
            
            progress = (processed / total_pages) * 100
            status_msg = f"⏳ Postęp: {processed}/{total_pages} ({progress:.1f}%) | Analizuję: {task['leaflet_name'][:30]}... Str. {task['page_number']}"
            
            with print_lock:
                print(f"\r{status_msg:<100}", end="", flush=True)
            
            found, msg, saved_path = future.result()
            
            if found:
                found_count += 1
                with print_lock:
                    print(f"\r{' '*100}\r", end="") 
                    print(msg)
                    print(f"   -> Zapisano: {saved_path}")
                
                # Wysyłanie na Discorda
                if DISCORD_URL:
                    discord_msg = f"🛒 **Znaleziono '{KEYWORD_TO_FIND}'!**\nGazetka: {task['leaflet_name']}\nStrona: {task['page_number']}"
                    send_discord_notification(discord_msg, saved_path)

    print(f"\n\n{'='*60}")
    print(f"   KONIEC SKANOWANIA")
    print(f"   Znaleziono {found_count} stron z frazą '{KEYWORD_TO_FIND}'.")
    print("="*60)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Wystąpił niespodziewany błąd: {e}")
        input("Naciśnij Enter, aby zamknąć...")