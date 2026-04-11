/**
 * LoginPage — welcome screen with login and register tabs.
 *
 * Demo credentials are shown prominently so workshop participants
 * can immediately log in without reading docs.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Waves } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { SharkLogo } from "@/components/SharkLogo";
import { useAuth } from "@/lib/auth";
import { apiRequest, setAuthToken } from "@/lib/queryClient";
import { loginSchema, registerSchema } from "@shared/schema";
import type { LoginInput, RegisterInput } from "@shared/schema";

// --- Login form -------------------------------------------------------------

function LoginForm({ onSuccess }: { onSuccess: (token: string, user: any) => void }) {
  const [showPw, setShowPw] = useState(false);
  const { toast } = useToast();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: LoginInput) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Login failed");
      }
      return res.json();
    },
    onSuccess: (data) => onSuccess(data.token, data.user),
    onError: (e: Error) => toast({ title: "Login failed", description: e.message, variant: "destructive" }),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-username">Username</Label>
        <Input
          id="login-username"
          placeholder="your_username"
          {...form.register("username")}
          data-testid="input-login-username"
        />
        {form.formState.errors.username && (
          <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPw ? "text" : "password"}
            placeholder="••••••••"
            {...form.register("password")}
            data-testid="input-login-password"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPw(!showPw)}
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {form.formState.errors.password && (
          <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
        )}
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending}
        data-testid="btn-login-submit"
      >
        {mutation.isPending ? "Diving in…" : "🦈 Dive In"}
      </Button>
    </form>
  );
}

// --- Register form ----------------------------------------------------------

function RegisterForm({ onSuccess }: { onSuccess: (token: string, user: any) => void }) {
  const [showPw, setShowPw] = useState(false);
  const { toast } = useToast();

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", email: "", password: "", confirmPassword: "", displayName: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: RegisterInput) => {
      const res = await apiRequest("POST", "/api/auth/register", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Registration failed");
      }
      return res.json();
    },
    onSuccess: (data) => onSuccess(data.token, data.user),
    onError: (e: Error) => toast({ title: "Registration failed", description: e.message, variant: "destructive" }),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-3">
      {[
        { id: "reg-display", name: "displayName", label: "Display Name", placeholder: "Fin McGillicuddy", type: "text" },
        { id: "reg-username", name: "username", label: "Username", placeholder: "fin_mcg", type: "text" },
        { id: "reg-email", name: "email", label: "Email", placeholder: "fin@ocean.com", type: "email" },
        { id: "reg-password", name: "password", label: "Password", placeholder: "••••••••", type: showPw ? "text" : "password" },
        { id: "reg-confirm", name: "confirmPassword", label: "Confirm Password", placeholder: "••••••••", type: showPw ? "text" : "password" },
      ].map(({ id, name, label, placeholder, type }) => (
        <div key={id} className="space-y-1">
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            type={type}
            placeholder={placeholder}
            {...form.register(name as any)}
            data-testid={`input-${name}`}
          />
          {(form.formState.errors as any)[name] && (
            <p className="text-xs text-destructive">
              {(form.formState.errors as any)[name]?.message}
            </p>
          )}
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        onClick={() => setShowPw(!showPw)}
      >
        {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
        {showPw ? "Hide" : "Show"} passwords
      </button>
      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending}
        data-testid="btn-register-submit"
      >
        {mutation.isPending ? "Creating account…" : "Create Account"}
      </Button>
    </form>
  );
}

// --- Main page --------------------------------------------------------------

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  function handleAuthSuccess(token: string, user: any) {
    setAuthToken(token);
    login(token, user);
    setLocation("/search");
  }

  const demoUsers = [
    { role: "Admin", username: "admin", password: "SharkAdmin123!", badge: "bg-red-900/50 text-red-300 border-red-700/40" },
    { role: "Editor", username: "editor", password: "SharkEdit123!", badge: "bg-amber-900/50 text-amber-300 border-amber-700/40" },
    { role: "Viewer", username: "viewer", password: "SharkView123!", badge: "bg-cyan-900/50 text-cyan-300 border-cyan-700/40" },
  ];

  return (
    <div className="min-h-screen shark-gradient flex flex-col items-center justify-center px-4 py-12">
      {/* Animated wave decoration */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none select-none opacity-20">
        <svg viewBox="0 0 1440 200" className="w-full wave-anim" fill="hsl(188 90% 48%)">
          <path d="M0,80 C360,160 1080,0 1440,80 L1440,200 L0,200 Z" />
        </svg>
      </div>

      <div className="w-full max-w-md relative z-10 fade-in">
        {/* Hero header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <SharkLogo size={52} showText={false} />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            Shark <span className="text-primary">Database</span>
          </h1>
          <p className="text-foreground/80 text-sm">
            The ocean's most comprehensive finned-friend directory
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-foreground/60">
            <Waves size={12} />
            <span>GitOps Demo Application</span>
          </div>
        </div>

        {/* Demo credentials card */}
        <Card className="shark-card mb-4">
          <CardHeader className="pb-3 pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Demo Credentials
            </p>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-2">
              {demoUsers.map((u) => (
                <div
                  key={u.username}
                  className="rounded-md bg-muted/40 px-3 py-2 space-y-1"
                  data-testid={`demo-cred-${u.role.toLowerCase()}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${u.badge}`}>
                      {u.role}
                    </span>
                    <code className="text-xs font-bold text-foreground">{u.username}</code>
                  </div>
                  <div className="flex gap-1.5 text-xs text-foreground/70">
                    <span className="text-muted-foreground">pw:</span>
                    <code className="font-mono text-foreground">{u.password}</code>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Auth form */}
        <Card className="shark-card">
          <CardContent className="pt-6">
            <Tabs defaultValue="login">
              <TabsList className="grid grid-cols-2 w-full mb-6 bg-muted">
                <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
                <TabsTrigger value="register" data-testid="tab-register">Register</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <LoginForm onSuccess={handleAuthSuccess} />
              </TabsContent>
              <TabsContent value="register">
                <RegisterForm onSuccess={handleAuthSuccess} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          🦈 Powered by OpenShift · ArgoCD · GitOps
        </p>
      </div>
    </div>
  );
}
