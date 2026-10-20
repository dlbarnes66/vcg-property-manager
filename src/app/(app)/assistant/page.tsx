import { AssistantChat } from "@/components/assistant-chat";
import { PageHeader } from "@/components/ui";
import { aiConfigured, aiModel } from "@/lib/ai/assistant";
import { ConversationList } from "./sidebar";

export const metadata = { title: "AI Assistant" };

export default function AssistantPage() {
  const ok = aiConfigured();
  return (
    <>
      <PageHeader title="AI Assistant" subtitle={ok ? `Answers from your live data · ${aiModel()}` : "Not set up yet: add ANTHROPIC_API_KEY to .env"} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <aside className="hidden lg:block"><ConversationList /></aside>
        <div className="lg:col-span-3"><AssistantChat initial={[]} configured={ok} /></div>
      </div>
    </>
  );
}
