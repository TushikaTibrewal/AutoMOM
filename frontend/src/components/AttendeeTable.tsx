import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2, UserPlus, Upload } from "lucide-react";
import type { Attendee, AttendeeGroup } from "@/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

const GROUPS: { value: AttendeeGroup; label: string }[] = [
  { value: "chairperson", label: "Chairperson" },
  { value: "faculty", label: "Faculty" },
  { value: "core_team", label: "Core Team" },
  { value: "member", label: "Member" },
  { value: "guest", label: "Guest" },
];

interface Props {
  attendees: Attendee[];
  onChange: (next: Attendee[]) => void;
}

/** Dynamic, virtualized attendee editor (smooth even with hundreds of rows). */
export function AttendeeTable({ attendees, onChange }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const virtualizer = useVirtualizer({
    count: attendees.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  const update = (index: number, patch: Partial<Attendee>) => {
    onChange(attendees.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const remove = (index: number) => {
    onChange(attendees.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...attendees, { name: "", role: "", department: "", present: true, group: "member" }]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const parsedAttendees: Attendee[] = [];

      // Check if it's a CSV file with headers or commas
      const firstLine = lines[0];
      const isCsv = file.name.endsWith(".csv") || (firstLine && firstLine.includes(","));

      if (isCsv && firstLine) {
        // Simple CSV parser
        let headers: string[] = [];
        let startIdx = 0;

        // Try to identify header row
        const firstLineParts = firstLine.split(",").map((p) => p.trim().toLowerCase());
        const hasHeader = firstLineParts.some((p) =>
          ["name", "role", "dept", "department", "group", "present"].includes(p)
        );

        if (hasHeader) {
          headers = firstLineParts;
          startIdx = 1;
        }

        for (let i = startIdx; i < lines.length; i++) {
          const parts = lines[i].split(",").map((p) => p.trim());
          if (parts.length === 0 || !parts[0]) continue;

          let name = parts[0];
          let role = "";
          let department = "";
          let group: AttendeeGroup = "member";
          let present = true;

          if (hasHeader) {
            const nameIdx = headers.indexOf("name");
            const roleIdx = headers.indexOf("role");
            const deptIdx = headers.findIndex((h) => h === "dept" || h === "department");
            const groupIdx = headers.indexOf("group");
            const presentIdx = headers.indexOf("present");

            if (nameIdx !== -1 && parts[nameIdx]) name = parts[nameIdx];
            if (roleIdx !== -1 && parts[roleIdx]) role = parts[roleIdx];
            if (deptIdx !== -1 && parts[deptIdx]) department = parts[deptIdx];

            if (groupIdx !== -1 && parts[groupIdx]) {
              const g = parts[groupIdx].toLowerCase().replace(" ", "_");
              if (["chairperson", "faculty", "core_team", "member", "guest"].includes(g)) {
                group = g as AttendeeGroup;
              }
            }
            if (presentIdx !== -1 && parts[presentIdx]) {
              const pStr = parts[presentIdx].toLowerCase();
              present = pStr !== "false" && pStr !== "no" && pStr !== "0" && pStr !== "absent";
            }
          } else {
            // Positional fallback
            if (parts[0]) name = parts[0];
            if (parts[1]) role = parts[1];
            if (parts[2]) department = parts[2];
            if (parts[3]) {
              const g = parts[3].toLowerCase().replace(" ", "_");
              if (["chairperson", "faculty", "core_team", "member", "guest"].includes(g)) {
                group = g as AttendeeGroup;
              }
            }
            if (parts[4]) {
              const pStr = parts[4].toLowerCase();
              present = pStr !== "false" && pStr !== "no" && pStr !== "0" && pStr !== "absent";
            }
          }

          parsedAttendees.push({ name, role, department, group, present });
        }
      } else {
        // Plain text: one name per line
        for (const line of lines) {
          if (!line) continue;
          parsedAttendees.push({
            name: line,
            role: "",
            department: "",
            group: "member",
            present: true,
          });
        }
      }

      if (parsedAttendees.length > 0) {
        onChange([...attendees, ...parsedAttendees]);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // clear selection
  };

  return (
    <div>
      <div className="mb-2 hidden grid-cols-[1fr_1fr_1fr_140px_90px_40px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
        <span>Name</span>
        <span>Role</span>
        <span>Department</span>
        <span>Group</span>
        <span>Present</span>
        <span />
      </div>

      <div ref={parentRef} className="max-h-[420px] overflow-y-auto pr-1">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const a = attendees[row.index];
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
                className="grid grid-cols-2 gap-2 border-b border-slate-100 py-2 dark:border-slate-800 md:grid-cols-[1fr_1fr_1fr_140px_90px_40px] md:items-center"
              >
                <Input
                  placeholder="Name"
                  value={a.name}
                  onChange={(e) => update(row.index, { name: e.target.value })}
                />
                <Input
                  placeholder="Role"
                  value={a.role}
                  onChange={(e) => update(row.index, { role: e.target.value })}
                />
                <Input
                  placeholder="Department"
                  value={a.department}
                  onChange={(e) => update(row.index, { department: e.target.value })}
                />
                <Select
                  value={a.group}
                  onChange={(e) => update(row.index, { group: e.target.value as AttendeeGroup })}
                >
                  {GROUPS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={a.present}
                    onChange={(e) => update(row.index, { present: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="md:hidden">Present</span>
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove attendee"
                  onClick={() => remove(row.index)}
                >
                  <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-500" />
                </Button>
              </div>
            );
          })}
        </div>
        {attendees.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No attendees yet. Add the people who were in the room.
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={add}>
          <UserPlus className="h-4 w-4" /> Add attendee
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" /> Upload members list
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={handleFileUpload}
        />
      </div>
    </div>
  );
}
