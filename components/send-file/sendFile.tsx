"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

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

const PAGE_SIZE = 10;

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const slugify = (value: string) =>
  (value || "document")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";

const buildStoragePath = (filename: string) => {
  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
  const baseName = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const safe = slugify(baseName);
  return `uploads/${crypto.randomUUID()}-${safe}${ext}`; // siempre con '/'
};

const DOCUMENTS_BUCKET = "documents"; // tu bucket

const MIME_EXTENSION_MAP: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.ms-word.document.macroEnabled.12": "docm",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

type DocumentRecord = {
  id: number;
  title: string;
  mimetype: string | null;
  created_at: string;
  status: string | null;
  error_message: string | null;
};

const formatMimeType = (value: string | null) => {
  if (!value) return "—";
  const mapped = MIME_EXTENSION_MAP[value];
  if (mapped) return mapped;

  const afterSlash = value.includes("/") ? value.split("/").pop() ?? value : value;
  const afterDot = afterSlash.includes(".")
    ? afterSlash.slice(afterSlash.lastIndexOf(".") + 1)
    : afterSlash;
  return afterDot.replace(/[^a-z0-9+]/gi, "").toLowerCase() || "—";
};

const formatDate = (value: string) => {
  try {
    return DATE_FORMATTER.format(new Date(value));
  } catch {
    return value;
  }
};

export default function SendFilePage() {
  const [formValues, setFormValues] = useState<FormFields>(initialFormState);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [page, setPage] = useState(0);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [refreshIndex, setRefreshIndex] = useState(0);
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

  useEffect(() => {
    let isMounted = true;

    const fetchDocuments = async () => {
      setIsLoadingDocuments(true);
      setDocumentsError(null);
      const supabase = createClient();
      const rangeStart = page * PAGE_SIZE;
      const rangeEnd = rangeStart + PAGE_SIZE - 1;

      const { data, error, count } = await supabase
        .from("documents")
        .select("id,title,mimetype,created_at,status,error_message", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(rangeStart, rangeEnd);

      if (!isMounted) return;

      if (error) {
        setDocuments([]);
        setDocumentsError(error.message || "We could not load the documents.");
      } else {
        setDocuments(data ?? []);
        setTotalDocuments(count ?? 0);
      }

      setIsLoadingDocuments(false);
    };

    fetchDocuments();

    return () => {
      isMounted = false;
    };
  }, [page, refreshIndex]);

  const totalPages = useMemo(
    () => (totalDocuments > 0 ? Math.ceil(totalDocuments / PAGE_SIZE) : 0),
    [totalDocuments],
  );

  const handleGoToPreviousPage = () => {
    setPage((prev) => Math.max(prev - 1, 0));
  };

  const handleGoToNextPage = () => {
    setPage((prev) => {
      if (totalPages === 0) return prev;
      return Math.min(prev + 1, totalPages - 1);
    });
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
      const supabase = createClient();
      const formData = new FormData();
      formData.append("title", formValues.title.trim());
      if (formValues.metadata.trim()) {
        formData.append("metadata", formValues.metadata.trim());
      }
      formData.append("file", selectedFile);
      const storagePath = buildStoragePath(selectedFile.name);
      const { error: uploadErr } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, selectedFile, {
          contentType: selectedFile.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadErr) {
        setErrorMessage(uploadErr.message || "We could not upload the file to storage.");
        setIsSubmitting(false);
        return;
      }

      const payload = {
        title: formValues.title.trim(),
        storagePath,
        mimetype: selectedFile.type,
        bytes: selectedFile.size,
        metadata: formValues.metadata.trim() ? JSON.parse(formValues.metadata) : {},
      };

      const res = await fetch("/api/send-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(
          typeof result?.error === "string" ? result.error : "We could not register the document.",
        );
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage("Document uploaded successfully (processing in background).");
      setFormValues(initialFormState);
      removeSelectedFile();
      setPage(0);
      setRefreshIndex((prev) => prev + 1);
      setIsSubmitting(false);
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
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-8 px-4 py-12">
        <Card className="w-full border-slate-800 bg-slate-900/80 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold text-slate-100">New document</CardTitle>
            <CardDescription className="text-slate-400">
              Save a PDF or Word file; we will store it together with its metadata.
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
                  placeholder="Operations manual"
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
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="font-semibold text-indigo-400 underline-offset-4 hover:underline"
                  >
                    Choose one from your device.
                  </button>
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
        <Card className="w-full border-slate-800 bg-slate-900/80 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur">
          <CardHeader className="space-y-2">
            <CardTitle className="text-xl font-semibold text-slate-100">Recent documents</CardTitle>
            <CardDescription className="text-slate-400">
              Review the upload history and check the processing status for each file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="min-w-full divide-y divide-slate-800">
                <thead className="bg-slate-900/90 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-medium">
                      Title
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">
                      Extension
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">
                      Uploaded
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/40 text-sm text-slate-200">
                  {isLoadingDocuments &&
                    Array.from({ length: PAGE_SIZE }).map((_, index) => (
                      <tr key={`skeleton-${index}`} className="animate-pulse">
                        <td className="px-4 py-4">
                          <div className="h-4 w-40 rounded bg-slate-800/80" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-16 rounded bg-slate-800/80" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-32 rounded bg-slate-800/80" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-24 rounded bg-slate-800/80" />
                        </td>
                      </tr>
                    ))}

                  {!isLoadingDocuments && documents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                        No documents have been uploaded yet.
                      </td>
                    </tr>
                  )}

                  {!isLoadingDocuments &&
                    documents.map((document) => {
                      const status = document.status ?? "—";
                      const normalizedStatus = status === "—" ? status : status.toUpperCase();
                      const isErrorStatus = status.toLowerCase() === "error";
                      const tooltipMessage =
                        isErrorStatus && document.error_message
                          ? document.error_message
                          : isErrorStatus
                            ? "No error details were provided."
                            : undefined;

                      return (
                        <tr key={document.id} className="transition hover:bg-slate-900/60">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-100">{document.title}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {formatMimeType(document.mimetype)}
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {formatDate(document.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                                isErrorStatus
                                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                                  : "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
                              }`}
                              title={tooltipMessage}
                            >
                              {normalizedStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {documentsError && <p className="text-sm text-red-400">{documentsError}</p>}

            <div className="flex items-center justify-between text-sm">
              <p className="text-slate-400">
                Page {totalPages === 0 ? 0 : page + 1} of {totalPages}
              </p>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleGoToPreviousPage}
                  disabled={page === 0 || totalPages === 0}
                  className="border border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800 disabled:opacity-50"
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleGoToNextPage}
                  disabled={totalPages === 0 || page >= totalPages - 1}
                  className="border border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800 disabled:opacity-50"
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
