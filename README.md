# Froggy

A polished, local-first game library built around the `games.zip` you supplied. Froggy serves game files directly from the ZIP as they are requested, so it does not unpack or duplicate the 1.9 GB archive.

## Put the source on GitHub

Upload the files in this folder to a GitHub repository. The `.gitignore` intentionally excludes `games.zip`: GitHub blocks ordinary files larger than 100 MB, and the game archive is about 1.9 GB. Keep the archive beside `server.mjs` for a local setup, or set `GAMES_ZIP` to its location. The server also falls back to the original archive path recorded in the catalog on the machine where it was indexed.

GitHub is a source-code host and does not run this Node.js server. To make Froggy playable as a hosted site, deploy it to a Node.js host and provide the game archive there. GitHub Pages alone cannot serve the ZIP-backed game assets.

## Run it

Requires Node.js 18 or later. From this folder, run:

```sh
npm start
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). The default archive path is the ZIP used to build this catalog. If you move the ZIP, point Froggy at it when starting the app:

```sh
GAMES_ZIP="/path/to/games.zip" npm start
```

Froggy uses two local ports: `4173` for the app and `4174` for game assets. The game frame is served from a separate local origin to keep it isolated from the app.

## Rebuild the game catalog

After replacing or updating the ZIP, rebuild the index and restart the server:

```sh
python3 tools/index_games.py "/path/to/games.zip"
npm start
```

The indexer reads complete ZIP entries and skips an incomplete tail. The current catalog contains 177 launchable game folders. Replacing the archive with a fuller copy and rebuilding the index can add more games.

## Included features

- Image-led game cards, category tiles, a featured mosaic, horizontal game shelves, search, favorites, and a load-more library
- A polished game player with a blurred launch preview, fullscreen auto-fit that centers and scales the game with blurred fill, restart controls, game details, and related games
- Favorites, recent games, and play sessions saved on this device
- A mascot-led Froggy brand and a compact, rounded search bar
- AdSense site-level code and a root `ads.txt` seller record. Enable Auto ads and approve the deployed domain in AdSense before ads can serve.
- Keyboard shortcut handling while a game has focus
- ZIP-backed streaming for game assets without extracting the library

## Check the game launchers

With Froggy running, check all catalog launch pages and their direct local HTML/CSS asset references:

```sh
npm run smoke-games
```

The project has no package dependencies beyond Node.js built-ins.

## AdSense setup

The publisher script is installed in the document head and `/ads.txt` serves the supplied seller record. Ad display depends on your AdSense site approval and Auto ads settings; the publisher ID alone cannot create a fixed ad unit. Standard AdSense content ads cannot be put inside an iframe or game interface. Google has a separate H5 Games Ad Placement API for eligible games, but each game must integrate the API in the same document as its game code; the archived games have not been adapted for that API. Auto ads placement/exclusion settings are managed in AdSense. See [Google's iframe policy](https://support.google.com/adsense/answer/3394713?hl=en), [H5 Games Ads setup](https://support.google.com/adsense/answer/9959170?hl=en), and [Auto ads setup](https://support.google.com/adsense/answer/9261307?hl=en).
