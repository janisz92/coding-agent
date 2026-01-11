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

Zadanie użytkownika jest po polsku.
Masz ZMIENIĆ PROJEKT, a odpowiedź zwrócić jako PATCH (git diff),
który agent zastosuje automatycznie.

ZASADY:
- Zwróć TYLKO sekcję PATCH:
- PATCH musi być poprawnym unified diff (git diff)
- Nie dodawaj wyjaśnień, markdown ani komentarzy
- Minimalne zmiany konieczne do wykonania zadania

REPO_ROOT:
${args.repoRoot}

MAPA_REPO:
${args.repoMap}

PLIKI_KONTEKSTOWE:
${filesText}

ZADANIE:
${args.task}

FORMAT ODPOWIEDZI:

PATCH:
diff --git ...
`;
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
`;
}
