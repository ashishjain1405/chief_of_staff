export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MeetingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const now = new Date().toISOString();

  const [upcomingRes, pastRes] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, title, start_time, end_time, attendees, status, meeting_url")
      .eq("user_id", user.id)
      .eq("status", "scheduled")
      .gte("start_time", now)
      .order("start_time")
      .limit(20),

    supabase
      .from("meetings")
      .select("id, title, start_time, end_time, transcript_summary, action_items, decisions, attendees")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("start_time", { ascending: false })
      .limit(20),
  ]);

  const upcoming = upcomingRes.data ?? [];
  const past = pastRes.data ?? [];

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <h1 className="text-2xl font-bold">Meetings</h1>

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Upcoming
          </h2>
          <div className="space-y-3">
            {upcoming.map((m) => (
              <Card key={m.id}>
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(m.start_time).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      ·{" "}
                      {new Date(m.start_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {(m.attendees as any[])?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {(m.attendees as any[]).map((a: any) => a.name ?? a.email).join(", ")}
                      </p>
                    )}
                  </div>
                  {m.meeting_url && (
                    <a
                      href={m.meeting_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      Join →
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Past Meetings
          </h2>
          <div className="space-y-4">
            {past.map((m) => {
              const actionItems = (m.action_items as any[]) ?? [];
              const decisions = (m.decisions as any[]) ?? [];

              return (
                <Card key={m.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-sm font-semibold">{m.title}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {new Date(m.start_time).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      {m.transcript_summary && (
                        <Badge variant="outline" className="text-xs">Summarized</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {m.transcript_summary && (
                      <p className="text-sm text-muted-foreground">{m.transcript_summary}</p>
                    )}

                    {actionItems.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-1.5">Action Items</p>
                        <ul className="space-y-1">
                          {actionItems.map((item: any, i: number) => (
                            <li key={i} className="text-xs flex items-start gap-2">
                              <span className="text-muted-foreground mt-0.5">•</span>
                              <span>
                                {item.description}
                                {item.owner && (
                                  <span className="text-muted-foreground"> ({item.owner})</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {decisions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-1.5">Decisions</p>
                        <ul className="space-y-1">
                          {decisions.map((d: any, i: number) => (
                            <li key={i} className="text-xs flex items-start gap-2">
                              <span className="text-muted-foreground mt-0.5">✓</span>
                              <span>{d.description}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No meetings yet.
          <br />
          <span className="text-xs">Connect Google Calendar in Settings to sync your meetings.</span>
        </div>
      )}
    </div>
  );
}
