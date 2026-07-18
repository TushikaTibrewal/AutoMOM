import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileDown, FileType2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ExportsPage() {
  const { data: exports, isLoading } = useQuery({
    queryKey: ["exports"],
    queryFn: api.recentExports,
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-bold">Recent exports</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Your last 20 generated documents
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : !exports?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <FileDown className="h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="font-medium">No exports yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Open a meeting and export it as PDF or DOCX.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {exports.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                  <FileType2 className="h-5 w-5 text-slate-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/meetings/${e.meeting_id}`} className="truncate font-medium hover:underline">
                    {e.meeting_title}
                  </Link>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {e.file_name} · {formatDate(e.created_at)}
                  </p>
                </div>
                <Badge tone={e.format === "pdf" ? "red" : "brand"}>{e.format.toUpperCase()}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
