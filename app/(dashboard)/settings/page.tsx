export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider, is_active, last_synced_at, metadata")
    .eq("user_id", user.id);

  const { data: profile } = await supabase
    .from("users")
    .select("business_context, preferences")
    .eq("id", user.id)
    .single();

  const connected = new Set((integrations ?? []).filter((i) => i.is_active).map((i) => i.provider));

  const integrationList = [
    {
      provider: "google",
      name: "Gmail + Calendar",
      icon: "📧",
      desc: "Email and calendar sync",
      connectHref: "/api/auth/google",
    },
    {
      provider: "slack",
      name: "Slack",
      icon: "💬",
      desc: "DMs and mentions",
      connectHref: "#",
    },
    {
      provider: "zoom",
      name: "Zoom",
      icon: "🎥",
      desc: "Meeting recordings and transcripts",
      connectHref: "#",
    },
  ];

  const bc = profile?.business_context as any ?? {};

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connected services and their sync status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {integrationList.map((i) => {
            const isConnected = connected.has(i.provider);
            const integration = integrations?.find((x) => x.provider === i.provider);
            const watchExpiry = integration?.metadata?.watch_expires_at;
            const isExpiringSoon =
              watchExpiry && new Date(watchExpiry) < new Date(Date.now() + 24 * 60 * 60 * 1000);

            return (
              <div key={i.provider} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{i.icon}</span>
                  <div>
                    <div className="font-medium text-sm">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{i.desc}</div>
                    {integration?.last_synced_at && (
                      <div className="text-xs text-muted-foreground">
                        Last synced: {new Date(integration.last_synced_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isExpiringSoon && (
                    <Badge variant="secondary" className="text-xs text-amber-600">Expiring soon</Badge>
                  )}
                  {isConnected ? (
                    <Badge variant="outline" className="text-green-600 border-green-300">Connected</Badge>
                  ) : (
                    <a href={i.connectHref}>
                      <Button size="sm" variant="outline">Connect</Button>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business Context</CardTitle>
          <CardDescription>This helps the AI understand your company and priorities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {bc.company_name && (
              <div>
                <span className="text-muted-foreground text-xs block">Company</span>
                {bc.company_name}
              </div>
            )}
            {bc.industry && (
              <div>
                <span className="text-muted-foreground text-xs block">Industry</span>
                {bc.industry}
              </div>
            )}
            {bc.stage && (
              <div>
                <span className="text-muted-foreground text-xs block">Stage</span>
                {bc.stage}
              </div>
            )}
          </div>
          {bc.description && (
            <p className="text-sm text-muted-foreground mt-3">{bc.description}</p>
          )}
          <a href="/onboarding">
            <Button variant="outline" size="sm" className="mt-4">Edit context</Button>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </CardContent>
      </Card>
    </div>
  );
}
