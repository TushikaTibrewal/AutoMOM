import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarDays, FileText, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";

const statusTone = { draft: "amber", generated: "brand", finalized: "green" } as const;

export default function DashboardPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useDebouncedEffect(() => setQuery(search), [search], 300);

  const { data: meetings, isLoading } = useQuery({
    queryKey: ["meetings", query],
    queryFn: () => api.listMeetings(query || undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteMeeting(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast("success", "Meeting deleted");
    },
    onError: () => toast("error", "Failed to delete meeting"),
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Meetings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Your meeting history and drafts
          </p>
        </div>
        <Button onClick={() => navigate("/new")}>
          <Plus className="h-4 w-4" /> New meeting
        </Button>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search by title, organization, type or transcript..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !meetings?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FileText className="h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="font-medium">No meetings yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Create your first meeting and let AutoMOM draft the minutes.
            </p>
            <Button onClick={() => navigate("/new")}>
              <Plus className="h-4 w-4" /> Start now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {meetings.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-4 py-4">
                  <Link to={`/meetings/${m.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{m.title}</p>
                      <Badge tone={statusTone[m.status as keyof typeof statusTone] ?? "neutral"}>
                        {m.status}
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {m.meeting_date || "No date"}
                      </span>
                      {m.organization && <span>{m.organization}</span>}
                      <span>{m.meeting_type}</span>
                      <span>Updated {formatDate(m.updated_at)}</span>
                    </p>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete meeting"
                    onClick={() => {
                      if (window.confirm(`Delete "${m.title}"? This cannot be undone.`)) {
                        deleteMutation.mutate(m.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-500" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
