import { useState } from "react";
import { MailWarning } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";

/** Shown to signed-in users who haven't verified their email yet. */
export function VerifyBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  if (!user || user.is_verified) return null;

  const resend = async () => {
    setSending(true);
    try {
      await api.resendVerification(user.email);
      toast("success", "Verification email sent — check your inbox");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Could not resend");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/25 dark:text-amber-200">
      <MailWarning className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        Please verify your email ({user.email}) to secure your account.
      </span>
      <button
        onClick={resend}
        disabled={sending}
        className="font-semibold underline underline-offset-2 hover:text-amber-900 disabled:opacity-60 dark:hover:text-amber-100"
      >
        {sending ? "Sending…" : "Resend email"}
      </button>
    </div>
  );
}
