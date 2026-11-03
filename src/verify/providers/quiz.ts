import { parseDetail, updateVerificationDetail } from "../../db";
import { parseQuizBank, type QuizQuestion } from "./quiz-bank";
import {
  assertPending,
  type ProviderStart,
  type ProviderSubmitResult,
  type VerifyContext,
  type VerifyProvider,
} from "../types";

const QUESTION_COUNT = 5;
const MAX_ATTEMPTS = 10;

function pickQuestions(bank: QuizQuestion[]): QuizQuestion[] {
  const pool = [...bank];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = (buf[0] as number) % (i + 1);
    [pool[i], pool[j]] = [pool[j] as QuizQuestion, pool[i] as QuizQuestion];
  }
  return pool.slice(0, Math.min(QUESTION_COUNT, pool.length));
}

function selectedQuestions(ctx: VerifyContext): QuizQuestion[] {
  const bank = parseQuizBank(ctx.config.quizBankRaw);
  const detail = parseDetail(ctx.verification.detail);
  const ids = Array.isArray(detail.quiz_ids) ? detail.quiz_ids.filter((v): v is string => typeof v === "string") : [];
  const selected = ids
    .map((id) => bank.find((q) => q.id === id))
    .filter((q): q is QuizQuestion => Boolean(q));
  return selected.length > 0 ? selected : pickQuestions(bank);
}

export const quizProvider: VerifyProvider = {
  id: "quiz",
  label: "答题",
  description: `答 ${QUESTION_COUNT} 道常识题，正确率达标即通过`,

  async start(ctx: VerifyContext): Promise<ProviderStart> {
    assertPending(ctx.verification);
    const questions = selectedQuestions(ctx);
    const detail = parseDetail(ctx.verification.detail);
    if (!Array.isArray(detail.quiz_ids)) {
      await updateVerificationDetail(ctx.db, ctx.verification.id, { quiz_ids: questions.map((q) => q.id), attempts: 0 });
    }
    return {
      questions: questions.map((q) => ({ id: q.id, question: q.question, options: q.options })),
      note: `正确率达到 ${ctx.config.quizPassScore}% 即通过`,
    };
  },

  async submit(ctx: VerifyContext, body: Record<string, unknown>): Promise<ProviderSubmitResult> {
    assertPending(ctx.verification);

    const answers = Array.isArray(body.answers) ? body.answers : null;
    if (!answers) return { ok: false, error: "答案格式不对，应为数字数组" };

    const questions = selectedQuestions(ctx);
    if (answers.length !== questions.length) {
      return { ok: false, error: `需要提交 ${questions.length} 道题的答案` };
    }

    const detail = parseDetail(ctx.verification.detail);
    const attempts = typeof detail.attempts === "number" ? detail.attempts : 0;
    if (attempts >= MAX_ATTEMPTS) {
      return { ok: false, error: "尝试次数过多，请联系群管理员人工处理" };
    }

    let correct = 0;
    for (let i = 0; i < questions.length; i += 1) {
      if (answers[i] === questions[i]?.answer) correct += 1;
    }
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= ctx.config.quizPassScore;

    await updateVerificationDetail(ctx.db, ctx.verification.id, { attempts: attempts + 1, last_score: score });

    if (!passed) {
      return {
        ok: false,
        error: `得分 ${score}，未达到 ${ctx.config.quizPassScore} 分，请再试一次（剩余 ${Math.max(0, MAX_ATTEMPTS - attempts - 1)} 次）`,
      };
    }

    return { ok: true, proof: { score, correct, total: questions.length } };
  },
};
