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

  const circleNumbers: Record<string, number> = {
    "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5,
    "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10,
  };

  // Try splitting by circled numbers first: ② 3+5=8 or ②3+5=8
  const circleParts = text.split(/([①②③④⑤⑥⑦⑧⑨⑩])/);

  if (circleParts.length > 1) {
    for (let i = 1; i < circleParts.length; i += 2) {
      const num = circleNumbers[circleParts[i]];
      const answer = circleParts[i + 1]?.trim();
      if (num && answer) {
        answers.push({ questionNumber: num, answerText: answer });
      }
    }
    return answers;
  }

  // Fallback: split by digit-based numbering like "2 3+5=8" or "2) 3+5=8"
  const digitPattern = /(\d+)[)\s]\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = digitPattern.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const answer = match[2].trim();
    if (num > 0 && num <= 10 && answer) {
      answers.push({ questionNumber: num, answerText: answer });
    }
  }

  // If no structured matches found, try line-by-line parsing
  if (answers.length === 0) {
    const lines = text.split("\n");
    for (const line of lines) {
      const lineMatch = line.match(/^\s*(\d+)[)\s]\s*(.+)/);
      if (lineMatch) {
        const num = parseInt(lineMatch[1], 10);
        const answer = lineMatch[2].trim();
        if (num > 0 && num <= 10 && answer) {
          answers.push({ questionNumber: num, answerText: answer });
        }
      }
    }
  }

  return answers;
}
