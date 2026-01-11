import OpenAI from "openai";

export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateText(prompt: string): Promise<string> {
  const response = await client.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  const anyResp = response as any;
  return (anyResp.output_text ?? "").toString();
}
