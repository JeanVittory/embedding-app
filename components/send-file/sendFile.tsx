"use client";

import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFields = {
  title: string;
  metadata: string;
};

const initialFormState: FormFields = {
  title: "",
  metadata: "",
};

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function SendFilePage() {
  const [formValues, setFormValues] = useState<FormFields>(initialFormState);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleTextChange =
    (field: keyof FormFields) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormValues((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
      setErrorMessage(null);
      setSuccessMessage(null);
    };

  const validateAndSetFile = (file: File | undefined) => {
    if (!file) return;
    if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
      setErrorMessage("Only PDF or Word (.docx) files are supported.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    validateAndSetFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    validateAndSetFile(file);
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedFile) {
      setErrorMessage("You need to attach a document before uploading.");
      return;
    }

    if (!formValues.title.trim()) {
      setErrorMessage("The document needs a title.");
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("title", formValues.title.trim());
      if (formValues.metadata.trim()) {
        formData.append("metadata", formValues.metadata.trim());
      }
      formData.append("file", selectedFile);
      const response = await fetch("/api/send-file", {
        method: "POST",
        body: formData,
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          typeof result?.error === "string"
            ? result.error
            : "We could not upload the document. Please try again.";
        setErrorMessage(detail);
        return;
      }

      setSuccessMessage("Document uploaded successfully.");
      setFormValues(initialFormState);
      removeSelectedFile();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We could not upload the document. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="min-h-[calc(100vh-4rem)] w-full text-slate-100">
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-4 py-12">
        <Card className="w-full border-slate-800 bg-slate-900/80 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold text-slate-100">New document</CardTitle>
            <CardDescription className="text-slate-400">
              Drag and drop a PDF or Word file; we will store it in Supabase together with its
              metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="title" className="text-slate-200">
                  Document title
                </Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="Manual de Operaciones"
                  required
                  value={formValues.title}
                  onChange={handleTextChange("title")}
                  className="border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="metadata" className="text-slate-200">
                  Metadata in JSON format (optional)
                </Label>
                <textarea
                  id="metadata"
                  name="metadata"
                  placeholder='{"lang":"en","category":"Kitchen"}'
                  value={formValues.metadata}
                  onChange={handleTextChange("metadata")}
                  className="min-h-[120px] w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 shadow-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-0"
                />
              </div>

              <div
                className={`flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition ${
                  isDragging
                    ? "border-indigo-400 bg-indigo-500/10"
                    : "border-slate-700 bg-slate-900/40"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hidden
                  onChange={handleFileChange}
                />
                <p className="text-center text-sm text-slate-300">
                  Drag your file here or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="font-semibold text-indigo-400 underline-offset-4 hover:underline"
                  >
                    choose one from your device
                  </button>
                  .
                </p>
                <p className="mt-2 text-center text-xs text-slate-500">
                  PDF or Word (.docx) files are accepted. Recommended max size: 15&nbsp;MB.
                </p>

                {selectedFile && (
                  <div className="mt-6 w-full rounded-md border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-200">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-slate-400">
                          {selectedFile.type || "Unknown type"} ·{" "}
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={removeSelectedFile}
                        className="border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-800"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}
              {successMessage && <p className="text-sm text-emerald-400">{successMessage}</p>}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={isSubmitting || !selectedFile}
                  className="bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 focus-visible:ring-indigo-400 disabled:pointer-events-none disabled:opacity-70"
                >
                  {isSubmitting ? "Uploading..." : "Upload document"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
