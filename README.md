# biedra_promo_hounter

BiedraBOT

## OCR cache

Skrypt zapisuje wyniki OCR do lokalnej bazy `ocr_cache.db` (SQLite + FTS5).

- strona gazetki jest OCR-owana tylko raz,
- przy kolejnych uruchomieniach wyszukiwanie słowa odbywa się po indeksie,
- OCR wykonywany jest tylko dla nowych stron, których nie ma jeszcze w cache.
