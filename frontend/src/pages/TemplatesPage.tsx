import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { LayoutTemplate, Upload } from "lucide-react";
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
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-2 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
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
    </div>
  );
}
