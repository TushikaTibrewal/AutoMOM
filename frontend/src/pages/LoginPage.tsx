import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { motion } from "framer-motion";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";

interface FormValues {
  email: string;
  full_name: string;
  password: string;
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const { login, register: registerUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>();

  const onSubmit = handleSubmit(async (values) => {
    setBusy(true);
    try {
      if (mode === "login") {
        await login(values.email, values.password);
        navigate("/");
      } else {
        const res = await registerUser(values.email, values.full_name, values.password);
        toast("success", res.message);
        setMode("login");
      }
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-slate-100 px-4 dark:from-slate-950 dark:via-slate-950 dark:to-brand-950/40">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <FileText className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">AutoMOM</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Messy notes in. Professional minutes out.
          </p>
        </div>

        <Card>
          <CardContent>
            <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(["login", "register"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                    mode === m
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                      : "text-slate-500"
                  }`}
                >
                  {m === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {mode === "register" && (
                <div>
                  <Label htmlFor="full_name">Full name</Label>
                  <Input
                    id="full_name"
                    placeholder="Dr. A. Sharma"
                    {...register("full_name", { required: mode === "register" })}
                  />
                  {errors.full_name && (
                    <p className="mt-1 text-xs text-rose-500">Full name is required</p>
                  )}
                </div>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...register("email", { required: true })}
                />
                {errors.email && <p className="mt-1 text-xs text-rose-500">Email is required</p>}
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  {...register("password", { required: true, minLength: 8 })}
                />
                {errors.password && (
                  <p className="mt-1 text-xs text-rose-500">Minimum 8 characters</p>
                )}
              </div>
              <Button type="submit" className="w-full" loading={busy}>
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
