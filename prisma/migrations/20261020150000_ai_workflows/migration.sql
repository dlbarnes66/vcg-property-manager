-- CreateEnum
CREATE TYPE "AiRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AgentActionKind" AS ENUM ('SEND_MESSAGE', 'CREATE_TASK', 'CREATE_WORK_ORDER', 'ADD_NOTE', 'RECORD_PAYMENT', 'POST_RENT', 'APPLY_LATE_FEES');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PROPOSED', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkflowTrigger" AS ENUM ('RENT_DUE_SOON', 'RENT_PAST_DUE', 'LEASE_ENDING', 'RECERT_DUE', 'INSPECTION_UPCOMING', 'INSPECTION_FAILED', 'APPLICATION_RECEIVED', 'WORK_ORDER_CREATED', 'MONTHLY');

-- CreateEnum
CREATE TYPE "WorkflowAction" AS ENUM ('SEND_TEMPLATE', 'CREATE_TASK', 'NOTIFY_ME', 'POST_RENT', 'APPLY_LATE_FEES');

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "kind" "AgentActionKind" NOT NULL,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "proposedBy" TEXT NOT NULL,
    "conversationId" TEXT,
    "workflowId" TEXT,
    "result" TEXT,
    "error" TEXT,
    "decidedByEmail" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "WorkflowTrigger" NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "action" "WorkflowAction" NOT NULL,
    "channel" "MessageChannel",
    "templateId" TEXT,
    "taskTitle" TEXT,
    "taskDueInDays" INTEGER NOT NULL DEFAULT 1,
    "taskPriority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "propertyId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowFiring" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowFiring_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT,
    "source" TEXT NOT NULL,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "fired" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_status_createdAt_idx" ON "AgentAction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowFiring_workflowId_subjectKey_key" ON "WorkflowFiring"("workflowId", "subjectKey");

-- CreateIndex
CREATE INDEX "WorkflowRun_startedAt_idx" ON "WorkflowRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFiring" ADD CONSTRAINT "WorkflowFiring_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

