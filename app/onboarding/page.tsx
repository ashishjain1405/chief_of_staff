"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const STEPS = ["Business Context", "Connect Integrations", "Done"];

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(searchParams.get("connected") === "google" ? 1 : 0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    company_name: "",
    industry: "",
    stage: "",
    description: "",
    goals: "",
    key_people: "",
  });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveContext() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("users")
      .update({
        business_context: form,
      })
      .eq("id", user.id);

    setLoading(false);
    if (error) {
      toast.error("Failed to save. Please try again.");
    } else {
      setStep(1);
    }
  }

  async function completeOnboarding() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("users")
      .update({ onboarding_complete: true })
      .eq("id", user.id);

    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <div className="w-full max-w-xl space-y-6">
        {/* Progress */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-colors ${
                  i < step
                    ? "bg-primary border-primary text-primary-foreground"
                    : i === step
                    ? "border-primary text-primary"
                    : "border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`text-sm ${i === step ? "font-medium" : "text-muted-foreground"}`}>
                {s}
              </span>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 0: Business Context */}
        {step === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Tell me about your business</CardTitle>
              <CardDescription>
                This helps the AI understand your context and give better insights.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Company Name</Label>
                  <Input
                    value={form.company_name}
                    onChange={(e) => update("company_name", e.target.value)}
                    placeholder="Acme Inc."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <Input
                    value={form.industry}
                    onChange={(e) => update("industry", e.target.value)}
                    placeholder="B2B SaaS, Fintech..."
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Stage</Label>
                <Input
                  value={form.stage}
                  onChange={(e) => update("stage", e.target.value)}
                  placeholder="Pre-seed, Seed, Series A..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>What does your company do?</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="We build software that..."
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Current top goals / priorities</Label>
                <Textarea
                  value={form.goals}
                  onChange={(e) => update("goals", e.target.value)}
                  placeholder="Close Series A, hire VP Engineering, launch v2..."
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Key people to track (optional)</Label>
                <Input
                  value={form.key_people}
                  onChange={(e) => update("key_people", e.target.value)}
                  placeholder="Lead investor, key customer, co-founder..."
                />
              </div>
              <Button
                onClick={saveContext}
                disabled={loading || !form.company_name}
                className="w-full"
              >
                {loading ? "Saving..." : "Continue"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 1: Connect Integrations */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Connect your tools</CardTitle>
              <CardDescription>
                Connect Gmail and Calendar to start. You can add Slack and Zoom in settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  name: "Gmail + Calendar",
                  icon: "📧",
                  desc: "Emails, calendar events, and meeting data",
                  href: "/api/auth/google",
                  required: true,
                },
                {
                  name: "Slack",
                  icon: "💬",
                  desc: "DMs and mentions",
                  href: "/settings",
                  required: false,
                },
                {
                  name: "Zoom",
                  icon: "🎥",
                  desc: "Meeting recordings and transcripts",
                  href: "/settings",
                  required: false,
                },
              ].map((integration) => (
                <a
                  key={integration.name}
                  href={integration.href}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{integration.icon}</span>
                    <div>
                      <div className="font-medium text-sm">{integration.name}</div>
                      <div className="text-xs text-muted-foreground">{integration.desc}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {integration.required && (
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        Recommended
                      </span>
                    )}
                    <span className="text-muted-foreground text-sm">→</span>
                  </div>
                </a>
              ))}

              <div className="pt-2">
                <Button onClick={completeOnboarding} disabled={loading} className="w-full">
                  {loading ? "Setting up..." : "Go to Dashboard"}
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  You can connect integrations later in Settings
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}
