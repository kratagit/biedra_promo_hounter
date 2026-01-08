# --- POCZĄTEK PEŁNEGO SKRYPTU (WERSJA 13 - ZAPISYWANIE OBRAZKÓW) ---

import requests
from bs4 import BeautifulSoup
import re
from PIL import Image
import pytesseract
from io import BytesIO
import os # Dodajemy import do obsługi folderów i plików

# --- KONFIGURACJA ---
# Wpisz tutaj ścieżkę do Tesseracta, jeśli program go nie znajduje
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
KEYWORD_TO_FIND = "papier" # Słowo kluczowe do wyszukania w obrazkach
SAVE_FOLDER = "gazetki" # Nazwa folderu do zapisu obrazków

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}
# --------------------

def sanitize_filename(name):
    """
    Funkcja pomocnicza do tworzenia bezpiecznych nazw plików.
    Usuwa niedozwolone znaki i zastępuje spacje podkreślnikami.
    """
    name = name.replace(" ", "_")
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    # Skracamy nazwę, żeby uniknąć problemów z długością ścieżki
    return name[:150]

def get_all_leaflet_uuids():
    """
    Dwustopniowy proces:
    1. Pobiera linki do stron pośrednich.
    2. Wchodzi na każdą stronę pośrednią, by wyciągnąć z jej kodu prawdziwe, długie ID (UUID).
    """
    main_page_url = "https://www.biedronka.pl/pl/gazetki"
    print(f"Krok 1: Pobieram stronę z listą gazetek: {main_page_url}")
    
    try:
        response = requests.get(main_page_url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        
        leaflet_links = soup.find_all('a', href=re.compile(r'/pl/press,id,'))
        unique_links = list(set([link.get('href') for link in leaflet_links]))
        
        if not unique_links:
            print("Nie znaleziono żadnych linków do gazetek.")
            return []
        
        print(f"Znaleziono {len(unique_links)} unikalnych gazetek. Rozpoczynam odkrywanie prawdziwych ID...")

        long_ids = set()
        for i, leaflet_page_url in enumerate(unique_links):
            print(f"  Analizuję stronę {i+1}/{len(unique_links)}: {leaflet_page_url}")
            try:
                page_resp = requests.get(leaflet_page_url, headers=HEADERS, timeout=10)
                page_resp.raise_for_status()
                match = re.search(r'window\.galleryLeaflet\.init\("([a-f0-9\-]{36})"\)', page_resp.text)
                if match:
                    found_id = match.group(1)
                    long_ids.add(found_id)
                    print(f"    -> Sukces! Odkryto ID: {found_id}")
                else:
                    print("    -> Błąd: Nie znaleziono skryptu z ID na tej podstronie.")
            except requests.exceptions.RequestException as e:
                print(f"    -> Błąd: Nie udało się pobrać podstrony. {e}")
                continue
        
        print(f"\nZebrano {len(long_ids)} unikalnych ID do przetworzenia.")
        return list(long_ids)

    except requests.exceptions.RequestException as e:
        print(f"Krytyczny błąd podczas pobierania głównej strony z gazetkami: {e}")
        return []

def get_leaflet_image_urls(leaflet_id):
    """Pobiera listę linków do obrazów PNG dla konkretnej gazetki."""
    try:
        api_url = f"https://leaflet-api.prod.biedronka.cloud/api/leaflets/{leaflet_id}?ctx=web"
        response = requests.get(api_url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        leaflet_data = response.json()
        image_urls = []
        for page_data in leaflet_data.get('images_desktop', []):
            valid_images = [img for img in page_data.get('images', []) if img]
            if valid_images:
                image_urls.append({"page": page_data.get('page'), "url": valid_images[0]})
        return leaflet_data.get('name', f'Gazetka {leaflet_id}'), image_urls
    except requests.exceptions.RequestException:
        return f'Gazetka {leaflet_id} (błąd pobierania)', []

def find_keyword_in_image_url(image_url, keyword):
    """
    Pobiera obraz, szuka słowa kluczowego.
    Zwraca (True, zawartość_obrazka) jeśli znajdzie, w przeciwnym razie (False, None).
    """
    try:
        response = requests.get(image_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        image_content = response.content
        img = Image.open(BytesIO(image_content))
        text = pytesseract.image_to_string(img, lang='pol')
        
        if keyword.lower() in text.lower():
            return True, image_content  # Zwracamy sukces i pobrane dane obrazka
        else:
            return False, None

    except Exception:
        return False, None

def main():
    # Krok 0: Stwórz folder do zapisu, jeśli nie istnieje
    os.makedirs(SAVE_FOLDER, exist_ok=True)
    print(f"Obrazki z promocjami będą zapisywane w folderze: '{SAVE_FOLDER}'")

    all_ids = get_all_leaflet_uuids()
    if not all_ids:
        print("\nNie udało się znaleźć żadnych gazetek. Koniec programu.")
        return

    print(f"\nRozpoczynam wyszukiwanie promocji na: '{KEYWORD_TO_FIND}'")
    found_promotions = []

    for leaflet_id in all_ids:
        leaflet_name, image_pages = get_leaflet_image_urls(leaflet_id)
        if not image_pages:
            print(f"\n--- Pomijam gazetkę: '{leaflet_name}' (brak stron lub błąd) ---")
            continue
            
        print(f"\n--- Sprawdzam gazetkę: '{leaflet_name}' ---")
        for page_info in image_pages:
            page_number = page_info['page']
            image_url = page_info['url']
            print(f"Analizuję stronę {page_number + 1}...", end="", flush=True)
            
            # Pobieramy wynik i ewentualną zawartość obrazka
            found, image_content = find_keyword_in_image_url(image_url, KEYWORD_TO_FIND)
            
            if found:
                print(f" ZNALEZIONO PROMOCJĘ! Pobieram obrazek...")
                
                # --- NOWA CZĘŚĆ: ZAPISYWANIE PLIKU ---
                safe_leaflet_name = sanitize_filename(leaflet_name)
                filename = f"{safe_leaflet_name}_strona_{page_number + 1}.png"
                filepath = os.path.join(SAVE_FOLDER, filename)
                
                try:
                    with open(filepath, 'wb') as f:
                        f.write(image_content)
                    print(f"  -> Zapisano jako: {filepath}")
                except IOError as e:
                    print(f"  -> Błąd zapisu pliku: {e}")

                found_promotions.append({
                    "leaflet_name": leaflet_name, "page_number": page_number + 1, "image_url": image_url
                })
            else:
                print(" brak.")
    
    print("\n\n--- PODSUMOWANIE ---")
    if found_promotions:
        print(f"Znaleziono promocję na '{KEYWORD_TO_FIND}' w następujących miejscach:")
        for promo in found_promotions:
            print(f"  - Gazetka: '{promo['leaflet_name']}', strona: {promo['page_number']}")
            print(f"    Link do strony: {promo['image_url']}")
    else:
        print(f"Niestety, nie znaleziono żadnej promocji na '{KEYWORD_TO_FIND}' w aktualnych gazetkach.")

if __name__ == "__main__":
    try:
        main()
    except pytesseract.TesseractNotFoundError:
        print("\n\nKRYTYCZNY BŁĄD: Nie znaleziono instalacji Tesseract OCR.")
    except Exception as e:
        print(f"\nWystąpił nieoczekiwany błąd: {e}")

# --- KONIEC PEŁNEGO SKRYPTU ---