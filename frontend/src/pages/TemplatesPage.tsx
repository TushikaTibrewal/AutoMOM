import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, LayoutTemplate, Upload, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export default function TemplatesPage() {
  const { data: templates, isLoading } = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadTemplate(file),
    onSuccess: ({ slug }) => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast("success", `Template "${slug}" installed`);
    },
    onError: (err) => toast("error", err instanceof ApiError ? err.message : "Upload failed"),
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Deterministic document designs. The AI never touches these.
          </p>
        </div>
        <Button onClick={() => fileRef.current?.click()} loading={upload.isPending}>
          <Upload className="h-4 w-4" /> Upload template (.zip)
        </Button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".zip"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
      </div>

      <p className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        A template zip must contain <code className="font-mono">meta.json</code> and{" "}
        <code className="font-mono">template.html</code> (Jinja2), optionally{" "}
        <code className="font-mono">styles.css</code> and <code className="font-mono">logo.png</code>.
        Installed templates appear instantly in the New Meeting flow.
      </p>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {templates?.map((t, i) => (
            <motion.div
              key={t.slug}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                {/* Live sample preview rendered by the backend template engine */}
                <div className="relative h-56 overflow-hidden border-b border-slate-100 bg-white dark:border-slate-800">
                  <iframe
                    title={`${t.name} preview`}
                    src={api.templatePreviewUrl(t.slug)}
                    className="pointer-events-none absolute left-0 top-0 origin-top-left"
                    style={{ width: "250%", height: "250%", transform: "scale(0.4)" }}
                  />
                  <button
                    onClick={() => setPreview(t.slug)}
                    className="absolute inset-0 flex items-end justify-end bg-transparent p-2 opacity-0 transition-opacity hover:bg-slate-900/10 hover:opacity-100"
                  >
                    <span className="inline-flex items-center gap-1 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow">
                      <Eye className="h-3.5 w-3.5" /> Full preview
                    </span>
                  </button>
                </div>
                <CardContent className="flex flex-col gap-2 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                      <LayoutTemplate className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-xs text-slate-400">{t.slug}</p>
                    </div>
                    <Badge className="ml-auto">v{t.version}</Badge>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Full-size preview modal */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
            onClick={() => setPreview(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="text-sm font-semibold">Template preview — sample minutes</p>
                <Button variant="ghost" size="icon" onClick={() => setPreview(null)} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <iframe
                title="Template full preview"
                src={api.templatePreviewUrl(preview)}
                className="h-full w-full bg-white"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
