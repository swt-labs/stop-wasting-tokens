import { createInterface } from 'node:readline';

import type { AskChoiceInput, AskConfirmInput, AskTextInput, Prompter } from '@swt-labs/core';

/**
 * Minimal readline-backed prompter. Used by `swt vibe verify` and milestone
 * UAT recovery on a TTY. Falls back to defaults when stdin isn't interactive.
 */
export class ReadlinePrompter implements Prompter {
  constructor(
    private readonly stdin: NodeJS.ReadableStream = process.stdin,
    private readonly stdout: NodeJS.WritableStream = process.stdout,
  ) {}

  async askChoice<T extends string>(input: AskChoiceInput<T>): Promise<T> {
    const lines = [
      input.prompt,
      ...input.options.map(
        (o, i) =>
          `  [${i + 1}] ${o.label}${o.description !== undefined ? ` — ${o.description}` : ''}`,
      ),
    ];
    if (input.defaultValue !== undefined) {
      lines.push(`(default: ${input.defaultValue})`);
    }
    const answer = await this.ask(`${lines.join('\n')}\n> `);
    const trimmed = answer.trim();
    if (trimmed.length === 0 && input.defaultValue !== undefined) {
      return input.defaultValue;
    }
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= input.options.length) {
      return input.options[numeric - 1]!.value;
    }
    const match = input.options.find((o) => o.value === trimmed || o.label === trimmed);
    if (match !== undefined) return match.value;
    if (input.defaultValue !== undefined) return input.defaultValue;
    throw new Error(`ReadlinePrompter: invalid choice "${trimmed}"`);
  }

  async askText(input: AskTextInput): Promise<string> {
    const suffix = input.defaultValue !== undefined ? ` (default: ${input.defaultValue})` : '';
    const answer = await this.ask(`${input.prompt}${suffix}\n> `);
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      if (input.defaultValue !== undefined) return input.defaultValue;
      if (input.required === true) {
        return this.askText(input);
      }
      return '';
    }
    return trimmed;
  }

  async askConfirm(input: AskConfirmInput): Promise<boolean> {
    const def = input.defaultValue === true ? 'Y/n' : 'y/N';
    const answer = await this.ask(`${input.prompt} (${def})\n> `);
    const lower = answer.trim().toLowerCase();
    if (lower.length === 0) return input.defaultValue ?? false;
    if (lower === 'y' || lower === 'yes') return true;
    if (lower === 'n' || lower === 'no') return false;
    return input.defaultValue ?? false;
  }

  private ask(prompt: string): Promise<string> {
    const rl = createInterface({ input: this.stdin, output: this.stdout });
    return new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
