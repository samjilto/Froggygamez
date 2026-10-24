#!/usr/bin/env python3
"""Build a small searchable catalog for a local games.zip archive.

The supplied archive has no central directory and ends mid-file. This reader
walks ZIP local headers, supports data descriptors, and keeps only complete
entries so a damaged tail cannot make earlier games disappear.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import struct
import sys
import zlib
from collections import defaultdict
from pathlib import Path

ROOT = "3kh0-assets-main/"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
HTML_EXTENSIONS = {".html", ".htm"}

SPECIAL_TITLES = {
    "1": "2048 Classic",
    "1v1lol": "1v1.LOL",
    "1v1space": "1v1 Space",
    "2048": "2048",
    "9007199254740992": "9007199254740992",
    "10-minutes-till-dawn": "10 Minutes Till Dawn",
    "a-dance-of-fire-and-ice": "A Dance of Fire and Ice",
    "among-us": "Among Us",
    "bad-ice-cream": "Bad Ice Cream",
    "bad-ice-cream-2": "Bad Ice Cream 2",
    "bad-ice-cream-3": "Bad Ice Cream 3",
    "btd4": "Bloons TD 4",
    "btd5": "Bloons TD 5",
    "btts": "Big Tower Tiny Square",
    "ctr": "Cut the Rope",
    "ctr-holiday": "Cut the Rope: Holiday",
    "ctr-tr": "Cut the Rope: Time Travel",
    "fnaw": "Five Nights at Winston’s",
    "fridaynightfunkin": "Friday Night Funkin’",
    "geodash": "Geometry Dash",
    "google-feud": "Google Feud",
    "google-snake": "Google Snake",
    "run 2": "Run 2",
    "stickman-survival": "Stickman Survival",
}

POPULAR = [
    "1v1lol", "2048", "bad-ice-cream", "basket-random", "cookie-clicker",
    "drive-mad", "fridaynightfunkin", "geodash", "google-snake", "run 2",
    "stickman-survival", "subway-surfers",
]

ART_OVERRIDES = {
    "cookie-clicker": ("cookie1.jpeg", "img/icon.png"),
    "fridaynightfunkin": ("assets/images/logo.png", "fnf-icon.jpg"),
    "google-snake": ("img/snake.png", "img/snake.png"),
}


def decode_name(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp437")


def zip64_sizes(extra: bytes, compressed: int, uncompressed: int) -> tuple[int, int]:
    if compressed != 0xFFFFFFFF and uncompressed != 0xFFFFFFFF:
        return compressed, uncompressed
    cursor = 0
    while cursor + 4 <= len(extra):
        tag, length = struct.unpack_from("<HH", extra, cursor)
        payload = extra[cursor + 4 : cursor + 4 + length]
        cursor += 4 + length
        if tag != 1:
            continue
        offset = 0
        if uncompressed == 0xFFFFFFFF:
            uncompressed = struct.unpack_from("<Q", payload, offset)[0]
            offset += 8
        if compressed == 0xFFFFFFFF:
            compressed = struct.unpack_from("<Q", payload, offset)[0]
        return compressed, uncompressed
    raise ValueError("ZIP64 size fields are missing their extra record")


def read_descriptor(file, offset: int, compressed_size: int, uncompressed_size: int) -> tuple[int, int, int, int]:
    file.seek(offset)
    raw = file.read(24)
    start = 4 if raw[:4] == b"PK\x07\x08" else 0
    # All complete entries in the supplied archive fit the 32-bit descriptor.
    crc, compressed, uncompressed = struct.unpack_from("<III", raw, start)
    length = start + 12
    if (compressed, uncompressed) != (compressed_size, uncompressed_size):
        if len(raw) >= start + 20:
            crc, compressed, uncompressed = struct.unpack_from("<IQQ", raw, start)
            length = start + 20
    if compressed != compressed_size or uncompressed != uncompressed_size:
        raise ValueError("data descriptor sizes do not match the deflate stream")
    return crc, compressed, uncompressed, length


def scan_archive(path: Path) -> tuple[list[dict], dict]:
    size = path.stat().st_size
    entries: list[dict] = []
    position = 0
    stopped_by = "end-of-archive"
    with path.open("rb") as file:
        while position + 4 <= size:
            file.seek(position)
            signature = file.read(4)
            if signature in (b"PK\x01\x02", b"PK\x05\x06", b"PK\x06\x06"):
                stopped_by = "central-directory"
                break
            if signature != b"PK\x03\x04":
                stopped_by = f"unexpected-bytes-at-{position}"
                break
            header = signature + file.read(26)
            if len(header) != 30:
                stopped_by = "short-local-header"
                break
            _, version, flags, method, _, _, crc, compressed_size, uncompressed_size, name_len, extra_len = struct.unpack(
                "<IHHHHHIIIHH", header
            )
            name_bytes = file.read(name_len)
            extra = file.read(extra_len)
            if len(name_bytes) != name_len or len(extra) != extra_len:
                stopped_by = "short-name-or-extra-field"
                break
            name = decode_name(name_bytes)
            try:
                compressed_size, uncompressed_size = zip64_sizes(extra, compressed_size, uncompressed_size)
            except (ValueError, struct.error):
                stopped_by = f"invalid-zip64-record:{name}"
                break
            data_offset = file.tell()
            descriptor_length = 0
            if flags & 0x08:
                if method != 8:
                    stopped_by = f"unsupported-descriptor-compression:{name}"
                    break
                inflater = zlib.decompressobj(-15)
                consumed = 0
                produced = 0
                while not inflater.eof:
                    block = file.read(1024 * 1024)
                    if not block:
                        stopped_by = f"truncated-descriptor-entry:{name}"
                        break
                    produced += len(inflater.decompress(block))
                    consumed += len(block)
                if not inflater.eof:
                    break
                compressed_size = consumed - len(inflater.unused_data)
                measured_uncompressed = produced
                try:
                    crc, compressed_size, uncompressed_size, descriptor_length = read_descriptor(
                        file, data_offset + compressed_size, compressed_size, measured_uncompressed
                    )
                except (ValueError, struct.error):
                    stopped_by = f"invalid-data-descriptor:{name}"
                    break
                uncompressed_size = measured_uncompressed
            next_position = data_offset + compressed_size + descriptor_length
            if next_position > size:
                stopped_by = f"truncated-entry:{name}"
                break
            if not name.endswith("/") and name.startswith(ROOT):
                entries.append(
                    {
                        "path": name[len(ROOT) :],
                        "size": uncompressed_size,
                        "compressedSize": compressed_size,
                        "method": method,
                        "dataOffset": data_offset,
                        "crc32": crc,
                    }
                )
            position = next_position

    metadata = {
        "archivePath": str(path.resolve()),
        "archiveSize": size,
        "indexedThrough": position,
        "completeEntries": len(entries),
        "stoppedBy": stopped_by,
    }
    return entries, metadata


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "game"


def display_title(folder: str) -> str:
    if folder in SPECIAL_TITLES:
        return SPECIAL_TITLES[folder]
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", folder)
    words = re.sub(r"[-_]+", " ", spaced).split()
    return " ".join(word if word.isupper() or word.isdigit() else word.capitalize() for word in words)


def title_from_html(file, entry: dict, folder: str) -> str:
    if entry["size"] > 1_500_000 or entry["compressedSize"] > 1_500_000:
        return display_title(folder)
    file.seek(entry["dataOffset"])
    payload = file.read(entry["compressedSize"])
    try:
        content = zlib.decompress(payload, -15) if entry["method"] == 8 else payload
        source = content[:1_500_000].decode("utf-8", errors="replace")
    except zlib.error:
        return display_title(folder)
    match = re.search(r"<title\b[^>]*>(.*?)</title\s*>", source, re.IGNORECASE | re.DOTALL)
    if not match:
        return display_title(folder)
    candidate = html.unescape(re.sub(r"<[^>]+>", "", match.group(1)))
    candidate = re.sub(r"\s+", " ", candidate).strip(" \t\r\n-–—|")
    if not candidate:
        return display_title(folder)
    if "|" in candidate:
        parts = [part.strip() for part in candidate.split("|") if part.strip()]
        if parts and parts[0].lower().startswith("unity webgl player"):
            candidate = parts[-1]
        elif parts and parts[0].lower() in {"3kh0", "home", "unblocked games"}:
            candidate = parts[-1]
        else:
            candidate = parts[0]
    candidate = re.sub(r"\s*[-–—]\s*(?:unblocked games(?: compilation)?|3kh0|play online)\s*$", "", candidate, flags=re.IGNORECASE).strip()
    if candidate.lower() == folder.lower() or candidate.lower() in {"unity webgl player", "game", "untitled"}:
        return display_title(folder)
    return candidate[:58]


def category_for(title: str) -> str:
    text = title.lower()
    if any(word in text for word in ("soccer", "football", "basket", "volley", "tennis", "golf", "racing", "race", "drift", "drive", "car", "bike", "skate")):
        return "Sports"
    if any(word in text for word in ("puzzle", "2048", "chess", "checkers", "mahjong", "sudoku", "word", "brain", "connect", "block", "match", "draw", "logic")):
        return "Puzzle"
    if any(word in text for word in ("shooter", "shoot", "war", "battle", "tank", "fight", "combat", "strike", "gun", "zombie", "survival", "1v1", "fps")):
        return "Action"
    if any(word in text for word in ("clicker", "idle", "tycoon", "miner", "simulator", "dress", "life", "farm", "fishing")):
        return "Casual"
    if any(word in text for word in ("adventure", "story", "quest", "escape", "prison", "horror", "island", "dungeon", "doom", "run ", "goodnight")):
        return "Adventure"
    return "Arcade"


def image_score(entry: dict, folder: str, is_icon: bool) -> int:
    path = entry["path"]
    ext = Path(path).suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        return -1
    basename = Path(path).name.lower()
    stem = Path(path).stem.lower()
    size = entry["size"]
    if size < 700:
        return -1
    score = 10
    if stem in {"cover", "thumbnail", "thumb", "og_image", "social", "game"}:
        score += 95
    if stem == folder.lower():
        score += 85
    if "cover" in stem or "thumbnail" in stem or "thumb" in stem:
        score += 60
    if "splash" in stem or "og_image" in stem or "preview" in stem:
        score += 55
    if "logo" in stem or "banner" in stem:
        score += 32
    if "icon" in stem or "favicon" in stem or "apple-touch-icon" in stem:
        score += 30 if is_icon else 10
    if path.count("/") == 0:
        score += 18
    if any(part in path.lower() for part in ("template", "font", "sprites", "texture", "atlas", "cursor", "loading", "loader")):
        score -= 28
    if ext == ".svg":
        score -= 8
    if size > 10_000_000:
        score -= 20
    if is_icon and any(token in stem for token in ("icon", "favicon", "logo", "apple-touch")):
        score += 35
    if is_icon and not any(token in stem for token in ("icon", "favicon", "logo", "apple-touch", "cover", "thumb", "splash")):
        score -= 18
    if is_icon and any(token in stem for token in ("sheet", "texture", "atlas", "sprite")):
        score -= 45
    if is_icon and "splash" in stem:
        score += 20
    if not is_icon and any(token in stem for token in ("cover", "thumb", "splash", "og_image", "game")):
        score += 20
    return score


def make_catalog(entries: list[dict], archive_path: Path) -> list[dict]:
    by_folder: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        parts = entry["path"].split("/")
        if len(parts) >= 2:
            entry["folder"] = parts[0]
            entry["relativePath"] = "/".join(parts[1:])
            by_folder[parts[0]].append(entry)

    catalog = []
    seen_ids: set[str] = set()
    with archive_path.open("rb") as archive:
      for folder, files in by_folder.items():
        html_files = [
            entry for entry in files
            if Path(entry["relativePath"]).suffix.lower() in HTML_EXTENSIONS
            and "/" not in entry["relativePath"]
        ]
        if not html_files:
            continue
        html_files.sort(key=lambda item: (Path(item["relativePath"]).name.lower() != "index.html", item["relativePath"].lower()))
        launch_file = html_files[0]["relativePath"]
        if folder.lower() == "readme.md":
            continue
        game_id = slugify(folder)
        if game_id in seen_ids:
            game_id = f"{game_id}-{len(seen_ids)}"
        seen_ids.add(game_id)
        title = title_from_html(archive, html_files[0], folder)
        image_candidates = [entry for entry in files if Path(entry["relativePath"]).suffix.lower() in IMAGE_EXTENSIONS]
        poster = max(image_candidates, key=lambda item: image_score(item, folder, False), default=None)
        icon_candidate = max(image_candidates, key=lambda item: image_score(item, folder, True), default=None)
        icon = icon_candidate if icon_candidate and image_score(icon_candidate, folder, True) >= 28 else poster
        if folder in ART_OVERRIDES:
            poster_path, icon_path = ART_OVERRIDES[folder]
            poster = next((entry for entry in image_candidates if entry["relativePath"] == poster_path), poster)
            icon = next((entry for entry in image_candidates if entry["relativePath"] == icon_path), icon)
        catalog.append(
            {
                "id": game_id,
                "folder": folder,
                "title": title,
                "category": category_for(title),
                "launchFile": launch_file,
                "poster": poster["relativePath"] if poster else None,
                "icon": icon["relativePath"] if icon else None,
                "featuredRank": POPULAR.index(folder) if folder in POPULAR else 999,
                "fileCount": len(files),
            }
        )
    catalog.sort(key=lambda game: (game["featuredRank"], game["title"].casefold()))
    return catalog


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="?", default=str(Path.home() / "Downloads" / "games.zip"))
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / "data"))
    args = parser.parse_args()
    archive = Path(args.archive).expanduser()
    output = Path(args.output)
    if not archive.is_file():
        print(f"Could not find the game archive: {archive}", file=sys.stderr)
        return 2
    output.mkdir(parents=True, exist_ok=True)
    entries, metadata = scan_archive(archive)
    catalog = make_catalog(entries, archive)
    (output / "archive-index.json").write_text(json.dumps({"archive": metadata, "entries": entries}, separators=(",", ":")), encoding="utf-8")
    (output / "catalog.json").write_text(json.dumps({"games": catalog}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Indexed {len(entries):,} complete files and {len(catalog):,} playable game folders.")
    print(f"Archive scan stopped at byte {metadata['indexedThrough']:,}: {metadata['stoppedBy']}.")
    print(f"Wrote catalog data to {output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
