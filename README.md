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
- search_in_files: proste wyszukiwanie podciągów w plikach,
- get_baseline_info: metadane snapshotu stanu początkowego repo (tworzony automatycznie na starcie agenta),
- list_changed_files: lista plików added/modified/deleted względem snapshotu,
- read_file_original: odczyt oryginalnej wersji pliku ze snapshotu (dla porównań punktowych),
- diff_file_against_original: prosty unified diff aktualnej zawartości względem snapshotu.

Snapshot zapisywany jest w pliku .agent_baseline.json w katalogu repo i obejmuje zawartości plików nie większych niż maxReadBytes (domyślnie 400 kB). Dla większych plików porównanie odbywa się po rozmiarze.

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
- src/agent/tools.ts – implementacja narzędzi (listowanie/odczyt/zapis/usuwanie/wyszukiwanie plików i narzędzia do review).
- src/agent/security.ts – izolacja repo, denylista ścieżek, limity, bezpieczne rozwiązywanie ścieżek.
- src/agent/log.ts – prosty logger (agent.raw.txt, agent.diff.txt).
- resources/promts/codeAgentPromt.txt – prompt systemowy używany w roli system przy pierwszym wywołaniu modelu.
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

## Jak robić review zmian (code review z użyciem narzędzi)
Agent automatycznie tworzy snapshot bazowy repozytorium na starcie (plik .agent_baseline.json). Na jego podstawie dostępne są narzędzia do przeglądu zmian:
- get_baseline_info – sprawdzenie informacji o snapshotcie,
- list_changed_files – lista plików added/modified/deleted względem snapshotu,
- diff_file_against_original – unified diff oraz podsumowanie (ile linii dodano/usunięto),
- read_file_original – odczyt oryginalnej wersji pliku ze snapshotu (dla porównań punktowych).

Przykładowa procedura przeglądu przez agenta:
1) Uruchom agenta poleceniem "edit" i poproś o przygotowanie raportu z review. Np.:

```
npm run dev -- edit "Zrób code review zmian w repo. Użyj list_changed_files i diff_file_against_original do wygenerowania przeglądu; zapisz czytelne podsumowanie z rekomendacjami do pliku REVIEW.md." --repo .
```

2) Agent wykorzysta narzędzia review i zapisze raport (np. REVIEW.md). Dodatkowo w pliku agent.diff.txt znajdziesz wynik git diff względem HEAD.

Wskazówki do promptu (opcjonalnie):
- Ogranicz zakres, np. do ścieżki: „Przejrzyj tylko src/” – agent może użyć list_changed_files z prefix: "src/".
- Wymuś czytelny format raportu (sekcje: lista zmian, komentarze, ryzyka, rekomendacje).
- Poproś o propozycje konkretnych poprawek wraz ze wskazaniem plików/fragmentów.
- Ustal limity, np. maks. 1000 linii diffu na plik (parametr max_lines w diff_file_against_original).

Ograniczenia i uwagi dla review:
- Pliki większe niż maxReadBytes (domyślnie 400 kB) w snapshotcie nie mają zapisanej treści – porównanie odbywa się po rozmiarze, a diff treści nie będzie dostępny.
- Denylista ścieżek (np. .git/, node_modules/, dist/, .env) jest zawsze respektowana – te zasoby nie są analizowane.
- Jeśli repozytorium nie jest repozytorium git lub git diff zwróci błąd, agent.diff.txt nie zostanie wygenerowany.

## Uwagi
- Domyślny model to wartość z OPENAI_MODEL lub "gpt-5". Upewnij się, że wskazany model wspiera tool-calling i Responses API.
- Agent minimalizuje zakres zmian i wymaga wywołania read_file przed modyfikacją jakiegokolwiek pliku.
- Limit wywołań narzędzi w jednej sesji: domyślnie 50 (możesz zmienić w kodzie wywołania runAgent).
