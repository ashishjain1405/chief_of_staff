import AskChat from "@/components/ask/ask-chat";

export default function AskPage() {
  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <div className="p-6 pb-0">
        <h1 className="text-2xl font-bold">Ask AI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask anything about your emails, meetings, commitments, or contacts.
        </p>
      </div>
      <AskChat />
    </div>
  );
}
