export function buildPatchPrompt(args: {
  task: string;
  repoRoot: string;
  repoMap: string;
  files: Array<{ path: string; content: string }>;
}): string {
  const filesText = args.files
    .map((f) => `PLIK: ${f.path}\n---\n${f.content}\n---`)
    .join("\n\n");

  return `
Jesteś doświadczonym programistą (senior software engineer).
Twoim zadaniem jest wykonać polecenie i ZWRÓCIĆ WYŁĄCZNIE patch (git diff), nic więcej.

KRYTYCZNE ZASADY FORMATU (MUSISZ SPEŁNIĆ):
- Pierwsza linia odpowiedzi MUSI być dokładnie: PATCH:
- Druga linia MUSI zaczynać się od: diff --git
- Nie używaj backticków (\`), markdown, nagłówków, wyjaśnień ani komentarzy poza patchem.
- Zwracaj tylko unified diff zgodny z 'git diff'.
- Minimalne zmiany konieczne do wykonania zadania.
- Jeśli nie jesteś w stanie wykonać zadania, zwróć patch z poprawnym nagłówkiem PATCH: i diffem, który nic nie zmienia (ale nadal poprawny).

REPO_ROOT:
${args.repoRoot}

MAPA_REPO:
${args.repoMap}

PLIKI_KONTEKSTOWE:
${filesText}

ZADANIE:
${args.task}
`.trim();
}

export function buildPatchRepairPrompt(args: {
  repoRoot: string;
  task: string;
  rawModelOutput: string;
  errorMessage: string;
}): string {
  return `
Jesteś narzędziem konwertującym odpowiedzi na poprawny patch (git diff).

KONTEKST:
- Repo: ${args.repoRoot}
- Zadanie: ${args.task}
- Błąd walidacji: ${args.errorMessage}

WEJŚCIE (niepoprawna odpowiedź modelu):
${args.rawModelOutput}

ZADANIE:
Przepisz powyższe na poprawny unified diff gotowy do 'git apply'.

KRYTYCZNE ZASADY FORMATU:
- Pierwsza linia odpowiedzi MUSI być dokładnie: PATCH:
- Druga linia MUSI zaczynać się od: diff --git
- Bez backticków i bez markdown
- Tylko patch, nic więcej
`.trim();
}

export function buildReviewPrompt(args: {
  repoRoot: string;
  diffText: string;
  nameStatus: string;
}): string {
  return `
Jesteś surowym, ale pomocnym reviewerem (senior/staff engineer).
Zrób code review zmian w repozytorium. Odpowiadaj po polsku.

Zmienione pliki:
${args.nameStatus || "(brak)"}

DIFF:
${args.diffText}

WYMAGANIA:
1) PODSUMOWANIE
2) UWAGI BLOKUJĄCE
3) UWAGI NIEBLOKUJĄCE
4) BEZPIECZEŃSTWO / EDGE CASES
5) SUGEROWANE TESTY

Nie generuj patchy ani kodu.
`.trim();
}

export function buildGitApplyRepairPrompt(args: {
  repoRoot: string;
  task: string;
  badPatch: string;
  gitError: string;
}): string {
  return `
Jesteś narzędziem naprawiającym patch (git diff), aby dało się go zastosować w repozytorium.

KONTEKST:
- Repo: ${args.repoRoot}
- Zadanie: ${args.task}

BŁĄD z 'git apply':
${args.gitError}

WEJŚCIE (uszkodzony patch):
${args.badPatch}

ZADANIE:
Zwróć poprawiony unified diff, który zachowuje intencję zmian, ale jest poprawnym patchem
i przechodzi 'git apply --check'.

ZASADY:
- Pierwsza linia: PATCH:
- Druga linia: diff --git
- Bez backticków, bez markdown, bez komentarzy poza patchem
- Nie dodawaj zmian niepotrzebnych do zadania
`.trim();
}
