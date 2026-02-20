# --- POCZĄTEK PEŁNEGO SKRYPTU (WERSJA 26 - HYBRYDA: STANDARD + KANAŁ ZIELONY) ---

import requests
from bs4 import BeautifulSoup
import re
from PIL import Image, ImageOps, ImageEnhance
import pytesseract
from io import BytesIO
import os
import threading
import json
import sqlite3
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# --- KONFIGURACJA ---
load_dotenv() 

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

KEYWORD_TO_FIND = "baton" 
SAVE_FOLDER = "gazetki"
MAX_WORKERS = 5 # Utrzymujemy 5 wątków (każdy robi teraz 2x więcej pracy, więc nie zwiększamy)
OCR_CACHE_DB = "ocr_cache.db"

DISCORD_URL = os.getenv("DISCORD_WEBHOOK_URL")
MAX_DISCORD_SIZE_BYTES = 7.5 * 1024 * 1024 
MAX_DISCORD_FILES_COUNT = 10
MAX_DISCORD_EMBEDS_COUNT = 10

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

print_lock = threading.Lock()

# --------------------

def chunked(items, size=900):
    for i in range(0, len(items), size):
        yield items[i:i + size]

def init_cache_db():
    conn = sqlite3.connect(OCR_CACHE_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pages (
            image_url TEXT PRIMARY KEY,
            leaflet_id TEXT,
            leaflet_name TEXT,
            page_number INTEGER,
            ocr_text TEXT,
            indexed_at TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pages_leaflet_id ON pages(leaflet_id)")
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS ocr_fts
        USING fts5(
            image_url,
            leaflet_name,
            page_number UNINDEXED,
            ocr_text,
            tokenize = 'unicode61 remove_diacritics 2'
        )
        """
    )
    conn.commit()
    return conn

def get_cached_urls(conn, tasks):
    urls = [task["url"] for task in tasks]
    cached_urls = set()
    for urls_chunk in chunked(urls):
        placeholders = ",".join(["?"] * len(urls_chunk))
        query = f"SELECT image_url FROM pages WHERE image_url IN ({placeholders})"
        rows = conn.execute(query, urls_chunk).fetchall()
        cached_urls.update(row[0] for row in rows)
    return cached_urls

def build_fts_match_query(keyword):
    safe_keyword = keyword.replace('"', '""').strip()
    return f'"{safe_keyword}"'

def get_cached_hits(conn, tasks, keyword):
    if not tasks:
        return []

    task_by_url = {task["url"]: task for task in tasks}
    match_query = build_fts_match_query(keyword)
    hits = []

    for urls_chunk in chunked(list(task_by_url.keys())):
        placeholders = ",".join(["?"] * len(urls_chunk))
        query = f"""
            SELECT image_url, leaflet_name, page_number
            FROM ocr_fts
            WHERE ocr_fts MATCH ? AND image_url IN ({placeholders})
        """
        rows = conn.execute(query, [match_query, *urls_chunk]).fetchall()
        for image_url, leaflet_name, page_number in rows:
            task = task_by_url.get(image_url)
            if task:
                hits.append((task, leaflet_name, page_number))

    return hits

def save_page_to_cache(conn, task_data, ocr_text):
    now = datetime.utcnow().isoformat(timespec="seconds")
    conn.execute(
        """
        INSERT INTO pages (image_url, leaflet_id, leaflet_name, page_number, ocr_text, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(image_url) DO UPDATE SET
            leaflet_id=excluded.leaflet_id,
            leaflet_name=excluded.leaflet_name,
            page_number=excluded.page_number,
            ocr_text=excluded.ocr_text,
            indexed_at=excluded.indexed_at
        """,
        (
            task_data["url"],
            task_data["leaflet_id"],
            task_data["leaflet_name"],
            task_data["page_number"],
            ocr_text,
            now,
        ),
    )
    conn.execute("DELETE FROM ocr_fts WHERE image_url = ?", (task_data["url"],))
    conn.execute(
        "INSERT INTO ocr_fts (image_url, leaflet_name, page_number, ocr_text) VALUES (?, ?, ?, ?)",
        (
            task_data["url"],
            task_data["leaflet_name"],
            str(task_data["page_number"]),
            ocr_text,
        ),
    )

def keyword_in_text(text, keyword):
    words = re.findall(r"\w+", text.lower(), flags=re.UNICODE)
    return keyword.lower() in words

def save_image_bytes(leaflet_name, page_number, image_bytes):
    safe_name = sanitize_filename(leaflet_name)
    filename = f"{safe_name}_strona_{page_number}.png"
    path = os.path.join(SAVE_FOLDER, filename)
    with open(path, 'wb') as f:
        f.write(image_bytes)
    return path

def download_and_save_image(task_data):
    try:
        resp = requests.get(task_data["url"], headers=HEADERS, timeout=15)
        return save_image_bytes(task_data["leaflet_name"], task_data["page_number"], resp.content)
    except Exception:
        return None

def preprocess_red_background(img):
    """
    Metoda 'Snajper' z Wersji 25.
    Idealna na czerwone tła, słaba na turkusowe.
    Wyciąga kanał Zielony.
    """
    if img.mode != 'RGB':
        img = img.convert('RGB')
    
    r, g, b = img.split()
    
    # Używamy kanału G (Zielonego) jako bazy
    img = g 
    
    # Powiększenie dla małych liter
    img = img.resize((img.width * 2, img.height * 2), Image.Resampling.BILINEAR)
    
    # Progowanie
    fn = lambda x : 255 if x > 100 else 0
    img = img.point(fn, mode='1')
    return img

def preprocess_standard(img):
    """
    Metoda Standardowa.
    Dobra na białe, żółte, turkusowe tła.
    """
    # Konwersja na szarość
    img = img.convert('L')
    
    # Lekkie powiększenie pomaga zawsze
    img = img.resize((int(img.width * 1.5), int(img.height * 1.5)), Image.Resampling.BILINEAR)
    
    # Auto-kontrast
    img = ImageOps.autocontrast(img)
    return img

def compress_image_for_discord(image_path):
    try:
        img = Image.open(image_path)
        if img.mode in ("RGBA", "P"): 
            img = img.convert("RGB")
            
        if img.width > 2000:
            ratio = 2000 / img.width
            new_height = int(img.height * ratio)
            img = img.resize((2000, new_height), Image.Resampling.LANCZOS)

        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=75) 
        buffer.seek(0)
        return buffer
    except Exception as e:
        print(f"Błąd kompresji: {e}")
        return None

def send_single_batch(files_dict, embeds_list, batch_num):
    try:
        payload = {"content": "", "embeds": embeds_list}
        response = requests.post(DISCORD_URL, data={"payload_json": json.dumps(payload)}, files=files_dict)
        if response.status_code not in [200, 204]:
            print(f"\n⚠️ Błąd Discorda: {response.status_code}")
            if response.text:
                print(f"   Odpowiedź API: {response.text[:500]}")
        else:
            with print_lock:
                print(f"\n📨 Wysłano paczkę nr {batch_num}")
    except Exception:
        pass

def send_discord_gallery_dynamic(found_files):
    if not DISCORD_URL or not found_files: return
    print(f"\n📦 Pakowanie {len(found_files)} zdjęć dla Discorda...")

    current_batch_files = {}
    current_batch_embeds = []
    current_batch_size = 0
    current_batch_count = 0
    open_buffers = []
    batch_counter = 1

    for idx, file_path in enumerate(found_files):
        compressed_img = compress_image_for_discord(file_path)
        if not compressed_img: continue
        img_size = compressed_img.getbuffer().nbytes
        
        if (
            (current_batch_size + img_size > MAX_DISCORD_SIZE_BYTES)
            or (current_batch_count >= MAX_DISCORD_FILES_COUNT)
            or (len(current_batch_embeds) >= MAX_DISCORD_EMBEDS_COUNT)
        ):
            send_single_batch(current_batch_files, current_batch_embeds, batch_counter)
            batch_counter += 1
            current_batch_files = {}
            current_batch_embeds = []
            current_batch_size = 0
            current_batch_count = 0
            for b in open_buffers: b.close()
            open_buffers = []

        open_buffers.append(compressed_img)
        filename = f"img_{batch_counter}_{idx}.jpg"
        current_batch_files[filename] = (filename, compressed_img, "image/jpeg")
        
        embed = {"url": "https://www.biedronka.pl/pl/gazetki", "image": {"url": f"attachment://{filename}"}}
        if current_batch_count == 0:
            embed["title"] = f"Znaleziono: {KEYWORD_TO_FIND} (Paczka {batch_counter})"
            embed["color"] = 5763719
        current_batch_embeds.append(embed)
        current_batch_size += img_size
        current_batch_count += 1

    if current_batch_files:
        send_single_batch(current_batch_files, current_batch_embeds, batch_counter)
        for b in open_buffers: b.close()

def sanitize_filename(name):
    name = name.replace(" ", "_")
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    return name[:100]

def get_all_leaflet_uuids():
    main_page_url = "https://www.biedronka.pl/pl/gazetki"
    print(f"🔎 KROK 1: Skanuję stronę główną...")
    try:
        response = requests.get(main_page_url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        leaflet_links = soup.find_all('a', href=re.compile(r'/pl/press,id,'))
        unique_links = list(set([link.get('href') for link in leaflet_links]))
        
        if not unique_links: return []
        
        print(f"✅ Wykryto {len(unique_links)} gazetek. Pobieram ID...")
        long_ids = set()
        for i, link in enumerate(unique_links):
            full_url = link if link.startswith("http") else f"https://www.biedronka.pl{link}"
            try:
                page_resp = requests.get(full_url, headers=HEADERS, timeout=10)
                match = re.search(r'window\.galleryLeaflet\.init\("([a-f0-9\-]{36})"\)', page_resp.text)
                if match: long_ids.add(match.group(1))
            except: pass
        return list(long_ids)
    except: return []

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
                    "leaflet_id": leaflet_id,
                    "leaflet_name": name,
                    "page_number": page_data.get('page') + 1,
                    "url": valid_images[0],
                })
        return name, pages_info
    except: return "Nieznana", []

def process_page(task_data):
    url = task_data['url']
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        content = resp.content
        
        # Wczytujemy oryginał
        img_original = Image.open(BytesIO(content))
        
        # --- SKAN 1: STANDARDOWY (Dla turkusowych, białych itp.) ---
        img_std = preprocess_standard(img_original.copy()) # Kopia, żeby nie zepsuć oryginału
        text_std = pytesseract.image_to_string(img_std, lang='pol')
        
        # --- SKAN 2: SNAJPER (Dla czerwonych i trudnych kontrastów) ---
        img_red = preprocess_red_background(img_original.copy())
        # Tutaj używamy konfiguracji psm 6 (blok tekstu), bo po progowaniu napisy są wyraźne
        text_red = pytesseract.image_to_string(img_red, lang='pol', config='--psm 6')
        
        # Łączymy wyniki z obu skanów
        full_text = text_std + " " + text_red

        return full_text, content
    except Exception:
        return None, None

def main():
    os.makedirs(SAVE_FOLDER, exist_ok=True)
    print("="*60)
    print(f"   START SYSTEMU WYSZUKIWANIA PROMOCJI: '{KEYWORD_TO_FIND}'")
    print("="*60 + "\n")

    uuids = get_all_leaflet_uuids()
    if not uuids: return

    all_tasks = []
    print(f"\n📂 KROK 2: Przygotowuję listę stron...")
    for uuid in uuids:
        name, pages = get_leaflet_pages(uuid)
        if pages:
            print(f"   📄 {name[:50]:<50} ... {len(pages)} str.")
            all_tasks.extend(pages)
    
    total_pages = len(all_tasks)
    print(f"\n🗂️ KROK 3: Ładuję indeks OCR ({OCR_CACHE_DB})")

    conn = init_cache_db()
    cached_urls = get_cached_urls(conn, all_tasks)
    cached_tasks = [task for task in all_tasks if task["url"] in cached_urls]
    uncached_tasks = [task for task in all_tasks if task["url"] not in cached_urls]

    print(f"   ✅ W cache: {len(cached_tasks)} stron")
    print(f"   🆕 Do OCR: {len(uncached_tasks)} stron")

    all_found_images_paths = []
    found_count = 0

    print(f"\n🔍 KROK 4: Wyszukiwanie w indeksie dla znanych stron...")
    cached_hits = get_cached_hits(conn, cached_tasks, KEYWORD_TO_FIND)
    for task, leaflet_name, page_number in cached_hits:
        saved_path = download_and_save_image(task)
        if saved_path:
            found_count += 1
            all_found_images_paths.append(saved_path)
            print(f"🔥 ZNALEZIONO (CACHE)! {leaflet_name} (Str. {page_number})")
    
    print(f"\n🚀 KROK 5: OCR tylko dla nowych stron (hybrydowo)")
    processed = 0
    writes_since_commit = 0
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_task = {executor.submit(process_page, task): task for task in uncached_tasks}
        
        for future in as_completed(future_to_task):
            task = future_to_task[future]
            processed += 1
            progress = (processed / len(uncached_tasks)) * 100 if uncached_tasks else 100
            status_msg = f"⏳ {processed}/{len(uncached_tasks)} ({progress:.0f}%) | {task['leaflet_name'][:20]}... S.{task['page_number']}"
            with print_lock: print(f"\r{status_msg:<80}", end="", flush=True)
            
            ocr_text, image_bytes = future.result()
            if not ocr_text:
                continue

            save_page_to_cache(conn, task, ocr_text)
            writes_since_commit += 1
            if writes_since_commit >= 25:
                conn.commit()
                writes_since_commit = 0

            if keyword_in_text(ocr_text, KEYWORD_TO_FIND) and image_bytes:
                saved_path = save_image_bytes(task['leaflet_name'], task['page_number'], image_bytes)
                found_count += 1
                all_found_images_paths.append(saved_path)
                with print_lock:
                    print(f"\r{' '*80}\r", end="")
                    print(f"🔥 ZNALEZIONO! {task['leaflet_name']} (Str. {task['page_number']})")

    conn.commit()
    conn.close()

    print(f"\n\n{'='*60}")
    print(f"   Znaleziono: {found_count}")
    
    if DISCORD_URL and all_found_images_paths:
        send_discord_gallery_dynamic(all_found_images_paths)
    
    print("="*60)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Błąd: {e}")
        input("Enter...")