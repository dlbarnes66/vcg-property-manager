import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AssistantChat } from "@/components/assistant-chat";
import { PageHeader } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/assistant";
import { loadConversation } from "@/lib/ai/load";
import { deleteConversation } from "../../agent/actions";
import { ConversationList } from "../sidebar";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadConversation(id);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title={data.conversation.title}
        back={{ href: "/assistant", label: "AI Assistant" }}
        actions={<ActionForm action={deleteConversation.bind(null, id)} submitLabel="Delete chat" submitVariant="ghost" inline confirm="Delete this conversation? Proposed actions stay in Approvals." />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <aside className="hidden lg:block"><ConversationList activeId={id} /></aside>
        <div className="lg:col-span-3"><AssistantChat key={id + data.msgs.length} conversationId={id} initial={data.msgs} configured={aiConfigured()} /></div>
      </div>
    </>
  );
}
