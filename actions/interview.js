"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function generateQuiz() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      industry: true,
      skills: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const prompt = `
Generate 10 technical interview questions for a ${
    user.industry
  } professional${
    user.skills?.length
      ? ` with expertise in ${user.skills.join(", ")}`
      : ""
  }.

Each question should be multiple choice with exactly 4 options.

Return ONLY valid JSON in this format:

{
  "questions": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": "string",
      "explanation": "string"
    }
  ]
}

Do not include markdown fences.
Do not include any text outside the JSON.
`;

  try {
    const result = await genAI.interactions.create({
      model: "gemini-3.8-flash",
      input: prompt,
    });

    const text = result.output_text;

    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    const cleanedText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const quiz = JSON.parse(cleanedText);

    if (!quiz.questions || !Array.isArray(quiz.questions)) {
      throw new Error("Invalid quiz format returned by Gemini");
    }

    return quiz.questions;
  } catch (error) {
    console.error("Error generating quiz:", error);
    throw new Error("Failed to generate quiz questions");
  }
}

export async function saveQuizResult(questions, answers, score) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const questionResults = questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: answers[index],
    isCorrect: q.correctAnswer === answers[index],
    explanation: q.explanation,
  }));

  const wrongAnswers = questionResults.filter(
    (q) => !q.isCorrect
  );

  let improvementTip = null;

  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map(
        (q) =>
          `Question: "${q.question}"
Correct Answer: "${q.answer}"
User Answer: "${q.userAnswer}"`
      )
      .join("\n\n");

    const improvementPrompt = `
The user is preparing for a ${user.industry} technical interview.

The following questions were answered incorrectly:

${wrongQuestionsText}

Provide one concise and encouraging improvement tip.
Focus on the knowledge areas the user should study.

Keep the response under 2 sentences.
`;

    try {
      const tipResult = await genAI.interactions.create({
        model: "gemini-3.8-flash",
        input: improvementPrompt,
      });

      improvementTip =
        tipResult.output_text?.trim() || null;

      console.log(improvementTip);
    } catch (error) {
      console.error(
        "Error generating improvement tip:",
        error
      );
    }
  }

  try {
    const assessment = await db.assessment.create({
      data: {
        userId: user.id,
        quizScore: score,
        questions: questionResults,
        category: "Technical",
        improvementTip,
      },
    });

    return assessment;
  } catch (error) {
    console.error(
      "Error saving quiz result:",
      error
    );

    throw new Error("Failed to save quiz result");
  }
}

export async function getAssessments() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  try {
    const assessments = await db.assessment.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return assessments;
  } catch (error) {
    console.error(
      "Error fetching assessments:",
      error
    );

    throw new Error("Failed to fetch assessments");
  }
}