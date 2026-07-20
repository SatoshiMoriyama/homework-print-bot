export type CommandType =
  | "print_request"
  | "history"
  | "switch_child"
  | "modify_print"
  | "grade_text_answer"
  | "register_child"
  | "help";

export interface ParsedCommand {
  type: CommandType;
  childName?: string;
  text?: string;
}

const PRINT_KEYWORDS = ["プリント", "ぷりんと", "もんだい"];
const HISTORY_KEYWORDS = ["りれき", "履歴", "れきし"];

export function parseCommand(text: string, registeredChildNames: string[]): ParsedCommand {
  const trimmed = text.trim();

  // Check for print request
  if (PRINT_KEYWORDS.some((kw) => trimmed.includes(kw))) {
    return { type: "print_request" };
  }

  // Check for history request
  if (HISTORY_KEYWORDS.some((kw) => trimmed.includes(kw))) {
    return { type: "history" };
  }

  // Check for child switch (nickname match)
  for (const name of registeredChildNames) {
    if (trimmed.includes(name)) {
      return { type: "switch_child", childName: name };
    }
  }

  // Check for child registration pattern: "登録 たろうくん"
  const registerMatch = trimmed.match(/^(登録|とうろく)\s+(.+)$/);
  if (registerMatch) {
    return { type: "register_child", childName: registerMatch[2] };
  }

  // Default: could be a modification instruction or unknown
  return { type: "help", text: trimmed };
}

export function isModificationInstruction(text: string): boolean {
  const modKeywords = [
    "簡単",
    "かんたん",
    "むずかしく",
    "難しく",
    "増やして",
    "ふやして",
    "減らして",
    "へらして",
    "もっと",
    "変えて",
    "かえて",
    "やり直し",
    "やりなおし",
  ];
  return modKeywords.some((kw) => text.includes(kw));
}

export function parseTextAnswers(text: string): { questionNumber: number; answerText: string }[] {
  const answers: { questionNumber: number; answerText: string }[] = [];

  // Pattern: ② 3+5=8 or ②3+5=8
  const pattern = /[①②③④⑤⑥⑦⑧⑨⑩]|(\d+)/g;
  const circleNumbers: Record<string, number> = {
    "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5,
    "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10,
  };

  // Split by circle numbers or numbered patterns
  const parts = text.split(/([①②③④⑤⑥⑦⑧⑨⑩])/);

  for (let i = 1; i < parts.length; i += 2) {
    const num = circleNumbers[parts[i]];
    const answer = parts[i + 1]?.trim();
    if (num && answer) {
      answers.push({ questionNumber: num, answerText: answer });
    }
  }

  return answers;
}
