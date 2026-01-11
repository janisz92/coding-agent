# coding-agent

Minimalny agent do edycji plików w repozytorium przy użyciu tool-calling (OpenAI). Działa jako CLI, które:
- uruchamia pętlę agenta z zestawem narzędzi do pracy na plikach (listowanie, odczyt, zapis, usuwanie, wyszukiwanie),
- loguje pełny przebieg do pliku agent.raw.txt,
- próbuje zapisać raport zmian git diff do agent.diff.txt (jeśli repo jest repozytorium git).

## Wymagania
- Node.js >= 18
- Klucz API do OpenAI (zmienna środowiskowa OPENAI_API_KEY)

## Instalacja
1) Zainstaluj zależności:

```
npm install
```

2) Skonfiguruj zmienne środowiskowe. Najprościej skopiować plik przykładowy:

```
cp .env.example .env
```

Uzupełnij w .env wartość OPENAI_API_KEY. Opcjonalnie możesz ustawić OPENAI_MODEL (domyślnie: "gpt-5").

## Użycie CLI
Składnia (zdefiniowana w src/cli.ts):

```
npm run dev -- patch "<OPIS>" --repo <ścieżka>
npm run dev -- edit  "<OPIS>" --repo <ścieżka>
```

- OPIS: tekstowe zadanie dla agenta (np. „Dodaj plik README.md w root repo”).
- --repo: ścieżka do katalogu repo, w którym agent ma pracować. Jeśli nie podasz, użyty zostanie bieżący katalog.

Przykład:

```
npm run dev -- edit "Dodaj plik CONTRIBUTING.md z podstawowymi zasadami" --repo .
```

Po zakończeniu działania:
- agent.raw.txt zawiera surowy log komunikacji i wywołań narzędzi,
- agent.diff.txt (jeśli git diff działa) zawiera różnice względem HEAD.

## Funkcje i narzędzia agenta
Agent działa na podstawie tool-calling i udostępnia następujące narzędzia (patrz src/agent/tools.ts):
- list_files: listowanie plików w repo (z pominięciem ścieżek z denylisty),
- read_file: odczyt pliku tekstowego,
- write_file: zapis/utworzenie pliku (wymaga podania pełnej nowej treści),
- delete_file: usunięcie pliku,
- search_in_files: proste wyszukiwanie podciągów w plikach.

## Sandbox i bezpieczeństwo
Konfiguracja sandboxa znajduje się w src/agent/security.ts i jest stosowana m.in. przez RepoTools:
- Blokada path traversal: operacje są ograniczone do katalogu repo.
- Denylista katalogów: .git, node_modules, dist.
- Denylista plików: .env.
- Denylista rozszerzeń: .pem, .key.
- Limity rozmiaru: odczyt do 400 000 bajtów, zapis do 800 000 bajtów.

Dodatkowo, po zakończeniu pętli agent próbuje wykonać git diff (jedyna komenda systemowa używana lokalnie) wyłącznie do wygenerowania agent.diff.txt.

## Struktura projektu
- src/cli.ts – wejściowy CLI, parsowanie argumentów, uruchomienie agenta.
- src/openai.ts – inicjalizacja minimalnego klienta OpenAI (wymaga OPENAI_API_KEY).
- src/agent/run.ts – pętla agenta, integracja z OpenAI Responses API, logowanie, generowanie diffu.
- src/agent/tools.ts – implementacja narzędzi (listowanie/odczyt/zapis/usuwanie/wyszukiwanie plików).
- src/agent/security.ts – izolacja repo, denylista ścieżek, limity, bezpieczne rozwiązywanie ścieżek.
- src/agent/log.ts – prosty logger (agent.raw.txt, agent.diff.txt).
- tests/security.test.ts – testy bezpieczeństwa warstwy ścieżek i denylis (node:test).
- tests/tools.test.ts – plik testowy (na razie pusty, przygotowany pod rozbudowę).
- .env.example – przykład konfiguracji środowiska (ustaw OPENAI_API_KEY przed użyciem).
- package.json – skrypty npm i zależności.
- tsconfig.json – konfiguracja TypeScript.

## Skrypty
Zdefiniowane w package.json:
- dev: uruchamia CLI w trybie developerskim (tsx src/cli.ts),
- test: uruchamia testy (node --import tsx --test).

## Uruchamianie testów
```
npm test
```

## Uwagi
- Domyślny model to wartość z OPENAI_MODEL lub "gpt-5". Upewnij się, że wskazany model wspiera tool-calling i Responses API.
- Agent minimalizuje zakres zmian i wymaga wywołania read_file przed modyfikacją jakiegokolwiek pliku.
