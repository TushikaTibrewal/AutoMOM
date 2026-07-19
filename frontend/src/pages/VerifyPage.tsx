import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

type State = "verifying" | "success" | "error";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 StrictMode double-invoke
    ran.current = true;
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    api
      .verifyEmail(token)
      .then(async () => {
        setState("success");
        await refreshUser();
      })
      .catch((err) => {
        setState("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      });
  }, [token, refreshUser]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-slate-100 px-4 dark:from-slate-950 dark:via-slate-950 dark:to-brand-950/40">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            {state === "verifying" && (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-brand-500" />
                <p className="font-medium">Verifying your email…</p>
              </>
            )}
            {state === "success" && (
              <>
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <div>
                  <p className="text-lg font-semibold">Email verified</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Your AutoMOM account is now confirmed.
                  </p>
                </div>
                <Button onClick={() => navigate("/")}>Go to dashboard</Button>
              </>
            )}
            {state === "error" && (
              <>
                <XCircle className="h-12 w-12 text-rose-500" />
                <div>
                  <p className="text-lg font-semibold">Verification failed</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
                </div>
                <Link to="/">
                  <Button variant="outline">Back to app</Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
