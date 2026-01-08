# --- POCZĄTEK PEŁNEGO SKRYPTU (WERSJA 16 - NAPRAWIONY LICZNIK) ---

import requests
from bs4 import BeautifulSoup
import re
from PIL import Image
import pytesseract
from io import BytesIO
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- KONFIGURACJA ---
# Twoja ścieżka (nie zmieniam jej, jest poprawna)
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

KEYWORD_TO_FIND = "papier" 
SAVE_FOLDER = "gazetki"
MAX_WORKERS = 5  # Liczba wątków

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

# Blokada, żeby wątki nie pisały po sobie w konsoli
print_lock = threading.Lock()

# --------------------

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
    """Pobiera informacje o stronach danej gazetki."""
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
    """Funkcja wykonywana przez wątki - analiza pojedynczej strony."""
    url = task_data['url']
    name = task_data['leaflet_name']
    page = task_data['page_number']
    
    try:
        # Pobieranie
        resp = requests.get(url, headers=HEADERS, timeout=15)
        content = resp.content
        
        # OCR
        img = Image.open(BytesIO(content))
        text = pytesseract.image_to_string(img, lang='pol')
        
        # Sprawdzanie
        if KEYWORD_TO_FIND.lower() in text.lower():
            safe_name = sanitize_filename(name)
            filename = f"{safe_name}_strona_{page}.png"
            path = os.path.join(SAVE_FOLDER, filename)
            
            with open(path, 'wb') as f:
                f.write(content)
            
            return True, f"🔥 ZNALEZIONO PROMOCJĘ! Gazetka: '{name}' (Str. {page}) -> Zapisano plik."
        
        return False, None

    except Exception:
        return False, None

def main():
    os.makedirs(SAVE_FOLDER, exist_ok=True)
    print("="*60)
    print(f"   START SYSTEMU WYSZUKIWANIA PROMOCJI: '{KEYWORD_TO_FIND}'")
    print(f"   Folder zapisu: {os.path.abspath(SAVE_FOLDER)}")
    print("="*60 + "\n")

    # 1. Zbieranie ID
    uuids = get_all_leaflet_uuids()
    if not uuids: return

    # 2. Zbieranie stron (Przygotowanie)
    all_tasks = []
    print(f"\n📂 KROK 2: Przygotowuję listę stron do sprawdzenia:")
    
    for uuid in uuids:
        name, pages = get_leaflet_pages(uuid)
        if pages:
            print(f"   📄 {name[:50]:<50} ... ma {len(pages)} stron")
            all_tasks.extend(pages)
    
    total_pages = len(all_tasks)
    print(f"\n🚀 KROK 3: URUCHAMIAM TURBO SKANOWANIE ({MAX_WORKERS} wątki na raz)")
    print(f"   Łącznie do przeanalizowania: {total_pages} obrazów. To chwilę potrwa...\n")

    # 3. Wielowątkowe przetwarzanie
    processed = 0
    found_count = 0
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_task = {executor.submit(process_page, task): task for task in all_tasks}
        
        for future in as_completed(future_to_task):
            task = future_to_task[future]
            processed += 1
            
            # Dynamiczny pasek postępu (nadpisuje jedną linię)
            progress = (processed / total_pages) * 100
            status_msg = f"⏳ Postęp: {processed}/{total_pages} ({progress:.1f}%) | Analizuję: {task['leaflet_name'][:30]}... Str. {task['page_number']}"
            
            # Wypisujemy status (używając \r żeby wracać na początek linii)
            with print_lock:
                print(f"\r{status_msg:<100}", end="", flush=True)
            
            # Odbiór wyniku
            found, msg = future.result()
            if found:
                found_count += 1  # <--- TUTAJ BYŁ BRAKUJĄCY ELEMENT! TERAZ JUŻ JEST OK.
                with print_lock:
                    # Czyścimy linię statusu, wypisujemy sukces i w nowej linii wznawiamy status
                    print(f"\r{' '*100}\r", end="") 
                    print(msg)

    print(f"\n\n{'='*60}")
    print(f"   KONIEC SKANOWANIA")
    print(f"   Znaleziono {found_count} stron z frazą '{KEYWORD_TO_FIND}'.")
    print(f"   Sprawdź folder '{SAVE_FOLDER}'.")
    print("="*60)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Wystąpił niespodziewany błąd: {e}")
        input("Naciśnij Enter, aby zamknąć...")