export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  answer: number;
}

/**
 * 内置题库。想换题直接改这里，或用 QUIZ_BANK（JSON 数组）通过 env 覆盖。
 * 题目刻意做成"人类一眼会、脚本要额外处理"的常识/算术题，不追求强人机区分。
 */
export const DEFAULT_QUIZ_BANK: QuizQuestion[] = [
  { id: "q01", question: "一年有多少个月？", options: ["10", "11", "12", "13"], answer: 2 },
  { id: "q02", question: "17 + 26 等于多少？", options: ["33", "43", "44", "53"], answer: 1 },
  { id: "q03", question: "下面哪个是操作系统？", options: ["HTTP", "Linux", "JPEG", "SMTP"], answer: 1 },
  { id: "q04", question: "彩虹通常有几种颜色（常见说法）？", options: ["5", "6", "7", "9"], answer: 2 },
  { id: "q05", question: "把 3 个苹果平均分给 3 个人，每人几个？", options: ["0", "1", "2", "3"], answer: 1 },
  { id: "q06", question: "以下哪个是浏览器？", options: ["Firefox", "Redis", "Nginx", "Docker"], answer: 0 },
  { id: "q07", question: "一周有几天？", options: ["5", "6", "7", "8"], answer: 2 },
  { id: "q08", question: "100 减去 37 等于多少？", options: ["53", "63", "67", "73"], answer: 1 },
  { id: "q09", question: "水的化学式是什么？", options: ["CO2", "H2O", "O2", "NaCl"], answer: 1 },
  { id: "q10", question: "以下哪个不是编程语言？", options: ["Python", "Rust", "Photoshop", "Go"], answer: 2 },
];

export function parseQuizBank(raw: string | undefined): QuizQuestion[] {
  if (!raw) return DEFAULT_QUIZ_BANK;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_QUIZ_BANK;
    const bank: QuizQuestion[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      const { id, question, options, answer } = candidate;
      if (typeof id !== "string" || typeof question !== "string" || !Array.isArray(options)) continue;
      if (!options.every((o) => typeof o === "string")) continue;
      if (typeof answer !== "number" || answer < 0 || answer >= options.length) continue;
      bank.push({ id, question, options: options as string[], answer });
    }
    return bank.length > 0 ? bank : DEFAULT_QUIZ_BANK;
  } catch {
    return DEFAULT_QUIZ_BANK;
  }
}
