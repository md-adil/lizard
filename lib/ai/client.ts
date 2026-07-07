// Anthropic client factory. The API key is read server-side only; routes
// surface a missing key as a friendly 400 so the UI can show a setup banner.
import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = process.env.LIZARD_AI_MODEL || "claude-sonnet-5";

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiConfigError(
      "Set ANTHROPIC_API_KEY in the environment to enable AI queries (get a key at console.anthropic.com), then restart Lizard.",
    );
  }
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}
