export interface ChoiceOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
}

export interface AskChoiceInput<T extends string = string> {
  readonly prompt: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly defaultValue?: T;
}

export interface AskTextInput {
  readonly prompt: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
}

export interface AskConfirmInput {
  readonly prompt: string;
  readonly defaultValue?: boolean;
}

/**
 * Cross-runtime prompter abstraction. The CLI binds a terminal-backed
 * implementation; tests use ScriptedPrompter for deterministic runs.
 *
 * Implementations must respect autonomy: when answers are pre-supplied
 * (scripted or pure-vibe), the prompter must NOT block on stdin.
 */
export interface Prompter {
  askChoice<T extends string>(input: AskChoiceInput<T>): Promise<T>;
  askText(input: AskTextInput): Promise<string>;
  askConfirm(input: AskConfirmInput): Promise<boolean>;
}
