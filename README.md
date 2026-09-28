# B1 Glossar

An offline Windows glossary for the Netzwerk neu B1 vocabulary.

## Download

[Download B1 Glossar for Windows](https://github.com/SanjidArefin/netzwerk_neu_b1_glossar_soft/releases/latest/download/B1-Glossar-Setup.exe)

Requires Windows 10 or later.

## Development

```powershell
npm install
npm start
```

The app loads its curated vocabulary from `backend/data/glossary.json`; it does
not need a web server or an internet connection. It opens in dark mode by
default and remembers a user's light/dark preference.

## Checks

```powershell
npm run check
npm run validate-data
npm test
npm run test:electron
```

## Windows Installer

```powershell
npm run dist
```

The installer is created in `release/` with Start Menu, desktop shortcut, and
uninstall support.
