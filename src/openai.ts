import OpenAI from "openai";

/**
 * Minimalny klient OpenAI.
 * Wymaga zmiennej OPENAI_API_KEY.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
