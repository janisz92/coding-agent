# coding-agen

Minimalny CLI “coding agent” do automatycznego generowania i nakładania zmian w repozytorium na podstawie opisu zadania (komenda `patch`) oraz do wykonywania code review bieżących zmian (komenda `review`).

Projekt działa tak:
1. Zbiera mapę repo oraz wybrane pliki kontekstowe.
2. Wysyła prompt do OpenAI (Responses API).
3. Oczekuje odpowiedzi w formacie patcha `git diff`.
4. Waliduje patch (format + `git apply --check`), ewentualnie prosi model o naprawę.
5. Aplikuje patch do repo (`git apply`).

## Wymagania

- Node.js >= 18 (zalecane 20+)
- Git dostępny w PATH
- Repozytorium musi być zainicjalizowane i posiadać przynajmniej jeden commit
- Klucz API: `OPENAI_API_KEY`

## Instalacja

1. Zainstaluj zależności:
   - npm install

2. Ustaw klucz:
   - skopiuj do środowiska (np. PowerShell):
     - $env:OPENAI_API_KEY="..."
   - lub użyj pliku `.env` w katalogu repo:
     - OPENAI_API_KEY=...

## Uruchomienie (dev)

CLI uruchamiane jest przez `tsx`:
- npm run dev -- patch "OPIS ZADANIA" --repo <ścieżka>
- npm run dev -- review --repo <ścieżka>

`--repo` jest opcjonalne; domyślnie używany jest bieżący katalog roboczy.

## Build / start

W repo jest skrypt `build`, ale `tsconfig.json` ma ustawione `"noEmit": true`, więc `npm run build` nie wygeneruje katalogu `dist`.

W związku z tym:
- do uruchamiania używaj `npm run dev`, lub
- zmień konfigurację build (np. ustaw `noEmit: false` i `outDir: dist`) jeżeli chcesz używać `npm run start`.

## Komendy

### patch

Generuje i aplikuje zmiany w repo na podstawie opisu zadania.

Przykład:
- npm run dev -- patch "Dodaj obsługę flagi --dry-run i nie aplikuj patcha" --repo .

Co robi `patch`:
- sprawdza, że katalog jest repozytorium git (`git rev-parse --is-inside-work-tree`)
- skanuje repo (z pominięciem m.in. `node_modules`, `.git`, `dist`)
- wybiera do 12 plików kontekstowych (zwykle `src/**` oraz pliki `.json/.yml`)
- buduje prompt z mapą repo + kontekstem + zadaniem
- wysyła zapytanie do OpenAI i zapisuje surową odpowiedź do:
  - `agent.raw.txt`
- parsuje patch:
  - preferuje format zaczynający się od `PATCH:`
  - fallback: akceptuje odpowiedź zaczynającą się bezpośrednio od `diff --git`
- jeżeli parsing się nie uda, prosi model o naprawę i zapisuje:
  - `agent.raw.fix.txt`
- zapisuje patch do pliku tymczasowego:
  - `agent.patch`
- wykonuje walidację `git apply --check`; jeżeli nie przechodzi, prosi model o naprawę i zapisuje:
  - `agent.raw.fix2.txt`
- aplikuje patch:
  - `git apply --whitespace=fix agent.patch`
- usuwa `agent.patch`
- wypisuje listę zmienionych plików i statystyki (`git diff --name-status`, `git diff --stat`)

Ważne:
- narzędzie nie wykonuje commita; commit jest decyzją użytkownika
- patch jest aplikowany na aktualny stan working tree (upewnij się, że wiesz jakie masz lokalne zmiany)

### review

Wykonuje review aktualnych zmian w repozytorium (diff względem HEAD).

Przykład:
- npm run dev -- review --repo .

Co robi `review`:
- pobiera `git diff --name-status` oraz `git diff`
- jeżeli brak zmian: wypisuje komunikat i kończy
- wysyła do modelu prompt review (w języku polskim)
- wypisuje wynik na stdout

Uwaga: w `review` diff jest obcinany do 20k znaków.

## Pliki i architektura

- `src/cli.ts` – wejście CLI, obsługa komend `patch` i `review`
- `src/openai.ts` – połączenie z OpenAI (Responses API)
- `src/prompts.ts` – budowa promptów (patch, naprawa patcha, review, naprawa po błędzie git apply)
- `src/patch.ts` – parsowanie/walidacja patcha, zapis, `git apply`, cleanup
- `src/repo.ts` – listowanie plików repo, wybór plików kontekstowych, mapa repo
- `src/git.ts` – proste wrappery na komendy git

## Rozwiązywanie problemów

- "To nie jest repozytorium git. Zrób: git init + commit."
  - uruchamiasz poza repo lub nie masz żadnego commita

- "PATCH nie zaczyna się od 'diff --git'"
  - model nie zwrócił poprawnego patcha; sprawdź `agent.raw.txt` / `agent.raw.fix*.txt`

- `git apply --check failed` / `git apply failed`
