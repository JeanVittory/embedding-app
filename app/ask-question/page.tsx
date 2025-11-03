"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type ApiSuccess = {
  reply?: string;
  message?: string;
};

type ApiError = {
  error?: string;
  message?: string;
};

const MIN_MESSAGE_LENGTH = 4;

export default function AskQuestionPage() {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [responseMessage, setResponseMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setResponseMessage(null);

    const trimmedMessage = message.trim();

    if (trimmedMessage.length === 0) {
      setErrorMessage("You need to enter a question before sending it.");
      return;
    }

    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      setErrorMessage("Your question is too short. Add a little more detail.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/ask-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: trimmedMessage }),
      });

      const payload = (await response.json().catch(() => ({}))) as ApiSuccess & ApiError;

      if (!response.ok) {
        setErrorMessage(payload.error ?? payload.message ?? "We couldn't send your question.");
        return;
      }

      setResponseMessage(payload.reply ?? payload.message ?? "Question sent successfully.");
      setMessage("");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "We couldn't send your question. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="min-h-[calc(100vh-4rem)] w-full text-slate-100">
      <div className="mx-auto flex h-full w-full max-w-2xl items-center justify-center px-4 py-12">
        <Card className="w-full border-slate-800 bg-slate-900/80 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold text-slate-100">
              Ask the assistant
            </CardTitle>
            <CardDescription className="text-slate-400">
              Send a question and we&apos;ll forward it to our API for an answer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Write your question here..."
                className="min-h-[140px] border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-0"
                maxLength={2000}
                aria-label="Question"
                required
              />

              {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}
              {responseMessage && <p className="text-sm text-emerald-400">{responseMessage}</p>}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 focus-visible:ring-indigo-400"
                >
                  {isSubmitting ? "Sending..." : "Send question"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
