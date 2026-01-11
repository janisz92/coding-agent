# coding-agent

Prosty agent CLI do:
- generowania patchy (git diff) na podstawie opisu zadania,
- robienia code review zmian w repozytorium.

## Wymagania

- Node.js >= 18
- Git
- Zmienna środowiskowa: `OPENAI_API_KEY`

## Instalacja

```bash
npm install
```

Ustaw klucz API (przykładowo w PowerShell):

```powershell
$env:OPENAI_API_KEY="..."
```

Albo w `.env` w katalogu projektu:

```env
OPENAI_API_KEY=...
```

## Uruchomienie (dev)

```bash
npm run dev -- patch "OPIS ZADANIA" --repo .
```

## Build / start

Konfiguracja TypeScript ma `noEmit: true`, więc `npm run build` nie generuje `dist/`.
Najprościej uruchamiać przez `dev` (`tsx`).

Jeśli chcesz mieć `dist/`, zmień `tsconfig.json` (ustaw `noEmit: false` i `outDir`), a potem:

```bash
npm run build
npm start
```

## Komendy

### patch

Generuje patch (git diff) i automatycznie aplikuje go w repo.

```bash
npm run dev -- patch "Dodaj nową funkcję X" --repo <ścieżka_do_repo>
```

Po wykonaniu:
- zapisuje surowe wyjście modelu do `agent.raw.txt` w repo,
- aplikuje patch przez `git apply`,
- usuwa plik `agent.patch`.
