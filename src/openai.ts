import OpenAI from "openai";

/**
 * Minimalny klient OpenAI.
 * Wymaga zmiennej OPENAI_API_KEY.
 */
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey || !apiKey.trim()) {
  throw new Error(
    "[agent] Brak OPENAI_API_KEY. Ustaw zmienną środowiskową lub wpisz klucz w pliku .env (patrz .env.example)."
  );
}

export const openai = new OpenAI({
  apiKey,
});
