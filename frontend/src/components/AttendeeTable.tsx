import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2, UserPlus } from "lucide-react";
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

      <Button variant="outline" size="sm" className="mt-3" onClick={add}>
        <UserPlus className="h-4 w-4" /> Add attendee
      </Button>
    </div>
  );
}
